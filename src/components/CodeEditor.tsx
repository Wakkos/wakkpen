import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { indentWithTab } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { sass } from '@codemirror/lang-sass'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { isDark, useIsDark } from '../lib/theme'
import { emmetConfig, expandAbbreviation, EmmetKnownSyntax } from '@emmetio/codemirror6-plugin'

export type EditorLang = 'html' | 'css' | 'scss' | 'js'

// Emmet en HTML y CSS/SCSS: Tab expande la abreviatura (h1, ul>li*3, m10…); si no hay nada que expandir, indenta.
function emmet(syntax: EmmetKnownSyntax) {
  return [emmetConfig.of({ syntax }), Prec.high(keymap.of([{ key: 'Tab', run: expandAbbreviation }]))]
}

function langExt(lang: EditorLang) {
  switch (lang) {
    case 'html':
      return [html({ autoCloseTags: true }), emmet(EmmetKnownSyntax.html)]
    case 'css':
      return [css(), emmet(EmmetKnownSyntax.css)]
    case 'scss':
      return [sass(), emmet(EmmetKnownSyntax.scss)]
    case 'js':
      return javascript()
  }
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg-editor)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--bg-editor)', border: 'none' },
  '&.cm-focused': { outline: 'none' },
})

interface Props {
  value: string
  lang: EditorLang
  onChange?: (value: string) => void
  readOnly?: boolean
}

export function CodeEditor({ value, lang, onChange, readOnly = false }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const langComp = useRef(new Compartment())
  const roComp = useRef(new Compartment())
  const themeComp = useRef(new Compartment())
  const dark = useIsDark()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          // En claro, el resaltado por defecto de CodeMirror; los fondos salen de las variables del tema.
          themeComp.current.of(isDark() ? oneDark : []),
          baseTheme,
          langComp.current.of(langExt(lang)),
          roComp.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // Se crea una vez; los cambios se aplican abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    view.current?.dispatch({ effects: langComp.current.reconfigure(langExt(lang)) })
  }, [lang])

  useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(dark ? oneDark : []) })
  }, [dark])

  useEffect(() => {
    view.current?.dispatch({
      effects: roComp.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    })
  }, [readOnly])

  // Cambios que llegan de fuera (vista en vivo del profesor).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div className="code-editor" ref={host} />
}
