import { useEffect, useRef, useState } from 'react'

export default function ScannerTest() {
  const [live, setLive] = useState('(waiting)')
  const [info, setInfo] = useState('')
  const [log, setLog] = useState('')

  const burstRef = useRef<string[]>([])
  const gapsRef = useRef<number[]>([])
  const startRef = useRef<number | null>(null)
  const lastRef = useRef<number | null>(null)
  const liveRef = useRef(live)
  const infoRef = useRef(info)
  const logRef = useRef(log)

  liveRef.current = live
  infoRef.current = info
  logRef.current = log

  useEffect(() => {
    const finalize = (withEnter: boolean) => {
      const text = burstRef.current.join('')
      const len = burstRef.current.length
      const gaps = gapsRef.current
      const avg = gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) + 'ms' : '-'
      const min = gaps.length ? Math.min(...gaps).toFixed(1) + 'ms' : '-'
      const max = gaps.length ? Math.max(...gaps).toFixed(1) + 'ms' : '-'
      const dur = startRef.current !== null && lastRef.current !== null ? (lastRef.current - startRef.current).toFixed(1) + 'ms' : '-'
      setInfo(
        'last scan: [' + text + '] len=' + len +
        ' ended=' + (withEnter ? 'ENTER' : 'timeout') +
        ' avgGap=' + avg + ' minGap=' + min + ' maxGap=' + max + ' duration=' + dur
      )
      burstRef.current = []
      gapsRef.current = []
      startRef.current = null
      lastRef.current = null
      setLive('(waiting)')
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const now = performance.now()
      if (e.key === 'Enter') {
        setLog(logRef.current + 'ENTER (gap=' + (lastRef.current !== null ? (now - lastRef.current).toFixed(1) + 'ms' : '-') + ')\n')
        finalize(true)
        return
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (lastRef.current !== null) gapsRef.current.push(now - lastRef.current)
        if (startRef.current === null) startRef.current = now
        burstRef.current.push(e.key)
        lastRef.current = now
        setLive(burstRef.current.join(''))
        setLog(logRef.current + 'char=' + e.key + ' code=' + e.code + ' keyCode=' + e.keyCode + '\n')
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        setLog(logRef.current + 'special key=' + e.key + ' code=' + e.code + ' keyCode=' + e.keyCode + '\n')
      }
    }

    const onReset = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        burstRef.current = []
        gapsRef.current = []
        startRef.current = null
        lastRef.current = null
        setLive('(waiting)')
        setInfo('')
        setLog('')
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keydown', onReset)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keydown', onReset)
    }
  }, [])

  return (
    <div style={{ fontFamily: 'monospace', padding: '16px' }}>
      <h2>Barcode Scanner Input Test</h2>
      <p>Focus this page, then scan a barcode. Enter ends a burst. Ctrl+Shift+R to reset.</p>
      <div style={{ border: '1px solid #000', padding: '8px', margin: '8px 0', minHeight: '30px' }}>{live}</div>
      <div id="info">{info}</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{log}</div>
    </div>
  )
}
