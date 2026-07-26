import { useState, useEffect } from 'react'

interface Props {
  text: string
  onDone: () => void
}

export default function RouteBar({ text, onDone }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      onDone()
    }, 4000)
    return () => clearTimeout(timer)
  }, [onDone])

  if (!visible) return null

  return (
    <div className="route-bar">
      <span className="route-text">{text}</span>
      <div className="meteor"></div>
    </div>
  )
}
