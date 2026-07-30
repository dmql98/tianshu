import type { Message } from '@/types'
import ThinkingBlock from './ThinkingBlock'
import ToolCall from './ToolCall'

const showReasoning = () => localStorage.getItem('tianshu:showReasoning') !== 'false'

interface Props {
  message: Message
}

export default function MessageItem({ message }: Props) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (isTool) {
    return <ToolCall message={message} />
  }

  return (
    <div className={`msg-group ${isUser ? 'user' : 'star'}`}>
      {!isUser && message.reasoning && (
        <ThinkingBlock
          content={message.reasoning}
          duration={message.reasoning_duration}
          defaultExpanded={showReasoning()}
        />
      )}
      <div className="msg-bubble">
        {message.content.split('\n').map((line, i) => (
          <span key={i}>
            {line}
            {i < message.content.split('\n').length - 1 && <br />}
          </span>
        ))}
      </div>
      <div className="msg-time">{time}</div>
    </div>
  )
}
