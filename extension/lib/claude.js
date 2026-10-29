// Optional: Claude writes the draft comments and the opening lines instead of the fixed templates.
// It is called with plain fetch because a Chrome extension has no build step to bundle the SDK.
// Anything that goes wrong falls back to the templates, so a run never fails because of this.
import { commentOk } from './rules.js'

export const DEFAULT_MODEL = 'claude-haiku-5-5'

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

function explain(status, body) {
  const message = body?.error?.message || ''
  if (status === 401) return 'Anthropic did not accept the API key.'
  if (status === 403) return 'The API key is not allowed to use this model.'
  if (status === 404) return 'Anthropic does not know this model name.'
  if (status === 429) return 'Anthropic is limiting requests, or the monthly spend cap was reached.'
  if (status === 400 && /usage limits|credit balance/i.test(message)) return 'The spend limit or credit balance has run out.'
  if (status === 400) return message || 'Anthropic rejected the request.'
  return `Anthropic answered ${status}.`
}

async function post(cfg, body) {
  return fetch(`${cfg.api ?? 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })
}

// One request. Returns the model's text. Low effort keeps it quick and cheap; models without that setting get a retry without it.
export async function ask(cfg, system, userText, maxTokens = 2048) {
  const body = {
    model: cfg.model || DEFAULT_MODEL,
    max_tokens: maxTokens,
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: userText }],
  }
  let res
  try {
    res = await post(cfg, body)
    if (res.status === 400) {
      const peek = await res.clone().json().catch(() => null)
      if (/effort|output_config/i.test(peek?.error?.message || '')) {
        delete body.output_config
        res = await post(cfg, body)
      }
    }
  } catch {
    throw new Error('Could not reach Anthropic. Check your internet connection.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(explain(res.status, data))
  if (data?.stop_reason === 'refusal') throw new Error('Claude declined this request.')
  return (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
}

// The model is asked for a JSON array. Take the first [ ... ] it wrote, ignoring any text around it.
export function parseList(text, expected) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('Claude did not return a list.')
  let list
  try {
    list = JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('Claude returned a list that could not be read.')
  }
  if (!Array.isArray(list) || list.length !== expected) throw new Error('Claude returned the wrong number of items.')
  return list
}

export async function suggest(cfg, system, texts) {
  const text = await ask(cfg, system, JSON.stringify(texts), 300 + 120 * texts.length)
  return parseList(text, texts.length)
}

// Replaces template drafts and openers with Claude's, one by one, keeping the template wherever Claude's text breaks our rules.
export async function improve(cfg, result, log = async () => {}) {
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
      await log(`Claude comment suggestions unavailable (${e.message}). Used the built-in drafts.`)
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
      await log(`Claude opening lines unavailable (${e.message}). Used the built-in ones.`)
    }
  }
  if (used.comments || used.openers) {
    await log(`Claude wrote ${used.comments} draft comments and ${used.openers} opening lines.`)
  }
  return used
}

// Used by the settings page: one tiny real request, so a wrong key or model shows up straight away.
export async function check(cfg) {
  const text = await ask(cfg, 'Reply with the single word OK.', 'Ready?', 200)
  if (!text.trim()) throw new Error('Claude answered with nothing.')
  return cfg.model || DEFAULT_MODEL
}

