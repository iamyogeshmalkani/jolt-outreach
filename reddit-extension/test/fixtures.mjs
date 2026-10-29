// Reddit-shaped JSON (listing > children > { kind, data }), with the fields the extension reads.
export const post = (over = {}) => ({
  kind: 't3',
  data: {
    id: 'p1', subreddit: 'nosurf', title: 'How I finally cut my phone time in half', selftext: 'It took months but here is what worked for me.',
    author: 'op_user', score: 420, num_comments: 56, permalink: '/r/nosurf/comments/p1/how_i_finally_cut/',
    over_18: false, stickied: false, locked: false, archived: false, removed_by_category: null, ...over,
  },
})
export const comment = (over = {}) => ({
  kind: 't1',
  data: {
    id: 'c1', author: 'thoughtful_reader', body: 'Deleting the feed apps and keeping only messaging made the biggest difference for me.',
    score: 88, permalink: '/r/nosurf/comments/p1/how_i_finally_cut/c1/', distinguished: null, stickied: false, depth: 0, replies: '', ...over,
  },
})
export const listing = (children) => ({ kind: 'Listing', data: { after: null, children } })
export const commentsPage = (children, p = post()) => [listing([p]), listing([...children, { kind: 'more', data: { count: 12 } }])]
export const rules = (list) => ({ rules: list.map(([short_name, description = '']) => ({ kind: 'all', short_name, description, priority: 0 })) })
