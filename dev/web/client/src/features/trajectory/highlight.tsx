/** 把文本中的查询词（大小写不敏感）用 <mark> 高亮；空查询原样返回。 */
export default function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q || !text) return <>{text}</>
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase()
          ? <mark key={i} className="tjs-mark">{part}</mark>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}
