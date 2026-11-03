// Builds the shortcode Instagram would give a post made at `ms`: the post id is (time since 2011-08-24 shifted left 23 bits) plus a
// sequence number, written in a 64-character alphabet.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
export function codeAt(ms, n = 0) {
  let id = ((BigInt(Math.floor(ms)) - 1314220021721n) << 23n) + BigInt(n)
  let out = ''
  while (id > 0n) {
    out = ALPHABET[Number(id % 64n)] + out
    id /= 64n
  }
  return out.padStart(11, 'A')
}
