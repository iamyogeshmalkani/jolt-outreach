// Optional: an AI model writes the draft comments and the opening lines instead of the fixed templates.
// Two providers: Grok (xAI) and Claude (Anthropic). Both are called with plain fetch, because a Chrome extension has
// no build step to bundle an SDK. Anything that goes wrong falls back to the templates, so a run never fails because of this.
import { commentOk } from './rules.js'

export const PROVIDERS = {
  xai: { label: 'Grok', model: 'grok-4.20-0309-non-reasoning', api: 'https://api.x.ai' },
  anthropic: { label: 'Claude', model: 'claude-haiku-5-5', api: 'https://api.anthropic.com' },
}
export const providerOf = (cfg) => PROVIDERS[cfg.provider] ?? PROVIDERS.xai
export const modelOf = (cfg) => cfg.model || providerOf(cfg).model

export const COMMENT_SYSTEM = `You help a researcher join public TikTok conversations about phone and screen-time habits.
For each video caption you are given, write one short public comment (30 words at most) from an ordinary, curious viewer.
- Respond to what that caption actually says, and add one thought or ask one genuine question.
- Never mention any app, product, brand or company.
- No links, no emoji, no hashtags.
- No generic praise such as "love this" or "so true".
- Never claim a personal experience, result or feeling of your own.
Return only a JSON array of strings, one comment per caption, in the same order.`

export const OPENER_SYSTEM = `You help a researcher write the first line of a friendly private message to someone who commented publicly on TikTok about their own phone habits.
For each comment you are given, write one warm, casual sentence (22 words at most) that refers to exactly what that person said.
- No pitch, no link, no emoji, and do not start with "Hey".
- Do not mention any app, product or company.
Return only a JSON array of strings, one sentence per comment, in the same order.`

export const openerOk = (s) =>
  typeof s === 'string' && s.trim().length >= 10 && s.trim().length <= 200 && !/https?:\/\/|www\.|jolt/i.test(s)

function explain(label, status, message = '') {
  if (status === 401) return `${label} did not accept the API key.`
  if (status === 403) return `The ${label} key is not allowed to use this model, or the account has no credit or quota left.`
  if (status === 404) return `${label} does not know this model name.`
  if (status === 402 || (status === 400 && /usage limits|credit balance|quota|exceeded/i.test(message))) {
    return `The ${label} spend limit, credit balance or free quota has run out.`
  }
  if (status === 429) return `${label} is limiting requests, or the quota was reached.`
  if (status === 400) return message || `${label} rejected the request.`
  return `${label} answered ${status}.`
}

async function failure(label, res) {
  const data = await res.json().catch(() => null)
  const message = data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.message || ''
  return new Error(explain(label, res.status, message))
}

// ---- Anthropic: POST /v1/messages ----
async function askAnthropic(cfg, system, userText, maxTokens) {
  const base = cfg.api ?? PROVIDERS.anthropic.api
  const body = {
    model: modelOf(cfg),
    max_tokens: maxTokens,
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: userText }],
  }
  const send = () =>
    fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
  let res = await send()
  if (res.status === 400) {
    const peek = await res.clone().json().catch(() => null)
    if (/effort|output_config/i.test(peek?.error?.message || '')) {
      delete body.output_config // a model without the effort setting
      res = await send()
    }
  }
  if (!res.ok) throw await failure('Claude', res)
  const data = await res.json().catch(() => null)
  if (data?.stop_reason === 'refusal') throw new Error('Claude declined this request.')
  return (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
}

// ---- xAI (Grok): POST /v1/responses ----
async function askXai(cfg, system, userText, maxTokens) {
  const base = cfg.api ?? PROVIDERS.xai.api
  const send = (input) =>
    fetch(`${base}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: modelOf(cfg), max_output_tokens: maxTokens, input }),
    })
  let res = await send([
    { role: 'system', content: system },
    { role: 'user', content: userText },
  ])
  if (res.status === 400) res = await send(`${system}\n\n${userText}`) // if the message form is not accepted, send one plain string
  if (!res.ok) throw await failure('Grok', res)
  const data = await res.json().catch(() => null)
  if (data?.error) throw new Error(explain('Grok', 400, data.error.message || String(data.error)))
  // The reply can hold reasoning items too, so pick the message text by type.
  return (data?.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
}

export async function ask(cfg, system, userText, maxTokens = 2048) {
  try {
    return await (cfg.provider === 'anthropic' ? askAnthropic : askXai)(cfg, system, userText, maxTokens)
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Could not reach ${providerOf(cfg).label}. Check your internet connection.`)
    throw e
  }
}

// The model is asked for a JSON array. Take the first [ ... ] it wrote, ignoring any text around it.
export function parseList(text, expected) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('The model did not return a list.')
  let list
  try {
    list = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('The model returned a list that could not be read.')
  }
  if (!Array.isArray(list) || list.length !== expected) throw new Error('The model returned the wrong number of items.')
  return list
}

export async function suggest(cfg, system, texts) {
  const text = await ask(cfg, system, JSON.stringify(texts), 300 + 120 * texts.length)
  return parseList(text, texts.length)
}

// Replaces template drafts and openers with the model's, one by one, keeping the template wherever its text breaks our rules.
export async function improve(cfg, result, log = async () => {}) {
  const who = providerOf(cfg).label
  const used = { comments: 0, openers: 0 }
  if (result.videos.length) {
    try {
      const out = await suggest(cfg, COMMENT_SYSTEM, result.videos.map((v) => v.caption))
      result.videos.forEach((v, i) => {
        if (commentOk(out[i])) {
          v.draft = out[i].trim()
          used.comments++
        }
      })
    } catch (e) {
      await log(`${who} comment suggestions unavailable (${e.message}) Used the built-in drafts.`)
    }
  }
  if (result.people.length) {
    try {
      const out = await suggest(cfg, OPENER_SYSTEM, result.people.map((p) => p.comment))
      result.people.forEach((p, i) => {
        if (openerOk(out[i])) {
          p.opener = out[i].trim()
          used.openers++
        }
      })
    } catch (e) {
      await log(`${who} opening lines unavailable (${e.message}) Used the built-in ones.`)
    }
  }
  if (used.comments || used.openers) await log(`${who} wrote ${used.comments} draft comments and ${used.openers} opening lines.`)
  return used
}

// Used by the settings page: one tiny real request, so a wrong key or model shows up straight away.
export async function check(cfg) {
  const text = await ask(cfg, 'Reply with the single word OK.', 'Ready?', 200)
  if (!text.trim()) throw new Error(`${providerOf(cfg).label} answered with nothing.`)
  return modelOf(cfg)
}
