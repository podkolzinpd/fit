import { useEffect } from 'react'
import { initializeNativeOta } from './android-ota'

export function NativeUpdateLifecycle() {
  useEffect(() => { void initializeNativeOta() }, [])
  return null
}
