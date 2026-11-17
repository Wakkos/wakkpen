import { richText } from '../lib/exercises'

export function RichText({ text, className }: { text: string; className?: string }) {
  return <div className={`rich${className ? ` ${className}` : ''}`} dangerouslySetInnerHTML={{ __html: richText(text) }} />
}
