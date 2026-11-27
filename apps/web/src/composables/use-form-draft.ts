import { onMounted, watch, type WatchSource } from 'vue'
import type { z } from 'zod'

// Черновик формы в localStorage: восстанавливается при монтировании и сохраняется
// не чаще раза за кадр. Любая ошибка хранилища (приватный режим, квота, мусор в
// ключе) молча игнорируется — черновик лишь удобство и не должен ломать форму.
export function useFormDraft<T>(opts: {
  key: string
  schema: z.ZodType<T>
  snapshot: () => T
  isMeaningful: (draft: T) => boolean
  restore: (draft: T) => void
  sources: WatchSource[]
}) {
  function clearDraft() {
    try {
      localStorage.removeItem(opts.key)
    } catch {
      /* хранилище может быть отключено */
    }
  }

  function saveDraft() {
    try {
      const draft = opts.snapshot()
      if (!opts.isMeaningful(draft)) {
        clearDraft()
        return
      }
      localStorage.setItem(opts.key, JSON.stringify(draft))
    } catch {
      /* игнорируем */
    }
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(opts.key)
      if (!raw) return
      const parsed = opts.schema.safeParse(JSON.parse(raw))
      if (!parsed.success) return
      opts.restore(parsed.data)
    } catch {
      /* поврежденный черновик: игнорируем */
    }
  }

  let saveScheduled = false
  function scheduleSave() {
    if (saveScheduled) return
    saveScheduled = true
    requestAnimationFrame(() => {
      saveScheduled = false
      saveDraft()
    })
  }

  onMounted(loadDraft)
  watch(opts.sources, scheduleSave)

  return { clearDraft }
}
