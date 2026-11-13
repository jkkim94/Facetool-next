'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * DNA profile list + active selection via serve.py (:8765).
 * @param {string} [serverBase]
 */
export function useDnaProfiles(serverBase = 'http://localhost:8765') {
  const [dnaProfiles, setDnaProfiles] = useState([])
  const [dnaProfileId, setDnaProfileId] = useState('')
  const [dnaSwitching, setDnaSwitching] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${serverBase}/dna_profiles`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.profiles?.length) return
        setDnaProfiles(data.profiles)
        setDnaProfileId(data.active || data.profiles[0].id)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [serverBase])

  const switchDnaProfile = useCallback(
    async (nextId) => {
      if (!nextId || nextId === dnaProfileId) return dnaProfileId
      setDnaSwitching(true)
      try {
        const r = await fetch(`${serverBase}/dna/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: nextId }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'DNA 전환 실패')
        const active = data.active || nextId
        setDnaProfileId(active)
        return active
      } finally {
        setDnaSwitching(false)
      }
    },
    [serverBase, dnaProfileId],
  )

  return {
    dnaProfiles,
    dnaProfileId,
    dnaSwitching,
    switchDnaProfile,
    setDnaProfileId,
  }
}
