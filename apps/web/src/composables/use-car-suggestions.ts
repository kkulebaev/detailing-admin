import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CAR_SUGGESTIONS } from '@/lib/car-suggestions'

const MAX_CAR_SUGGESTIONS = 30
// Тап и протяжка приходят одной и той же парой pointer-событий, поэтому выбор
// засчитывается только если палец практически не сдвинулся.
const CAR_TAP_SLOP_PX = 12

// Подсказки «Марка и модель». Список сознательно собран на голом DOM, без Popover:
// на Android выбор тапом не доезжал ни через `mousedown`, ни через `click`. Что здесь
// принципиально и ломается при «упрощении»:
//   • список — обычный `absolute`-элемент рядом с полем, а не портал. У
//     `PopoverContent` есть `tabindex="-1"`, и тап по нему уводил фокус с поля;
//   • выбор висит на `pointerup`, а не на mouse-событиях: `pointer*` браузер
//     шлет всегда, а эмулированные mouse-события Chrome внутри прокручиваемого
//     контейнера придерживает и часто не шлет вовсе;
//   • скролл списка отделяется от тапа порогом сдвига пальца, иначе протяжка
//     выбирала бы случайный пункт (сам скролл жив: его решает `touch-action`, а
//     не `preventDefault` на pointerdown — тот лишь удерживает фокус в поле);
//   • пункты — `<li>`, а не `<button>`: неинтерактивный элемент не забирает
//     фокус, поле не теряет каретку и клавиатуру;
//   • список не закрывается по `blur` — тот прилетал раньше тапа. Закрытие: сам
//     выбор, Escape и `pointerdown` мимо `[data-car-input]` и `[data-car-suggestions]`.
export function useCarSuggestions(query: () => string, onPick: (car: string) => void) {
  const open = ref(false)
  const activeIndex = ref(0)
  const listEl = ref<HTMLElement | null>(null)
  const inputEl = ref<HTMLInputElement | null>(null)

  const filtered = computed<readonly string[]>(() => {
    const q = query().trim().toLowerCase()
    if (!q) return CAR_SUGGESTIONS.slice(0, MAX_CAR_SUGGESTIONS)
    return CAR_SUGGESTIONS.filter((c) => c.toLowerCase().includes(q)).slice(0, MAX_CAR_SUGGESTIONS)
  })
  watch(filtered, () => {
    activeIndex.value = 0
  })

  function select(car: string) {
    const el = inputEl.value
    if (el) {
      // Тап мимо `pointerdown.prevent` мог увести фокус с поля — на мобильном это
      // гасит клавиатуру.
      el.focus()
      // Фокус в поле означает, что Gboard может держать слово в композиции, а
      // v-model из Vue не трогает DOM, пока выставлен `el.composing`. Коммитим
      // композицию сами, иначе подсказка осядет только в состоянии формы.
      el.value = car
      el.setSelectionRange(car.length, car.length)
      el.dispatchEvent(new CompositionEvent('compositionend', { data: car }))
    }
    onPick(car)
    open.value = false
  }

  // Тап по уже сфокусированному полю не дает `focus`, поэтому список открывается и
  // по клику — иначе вернуть его после выбора можно было бы только новым символом.
  function openSuggestions(e: Event) {
    if (e.target instanceof HTMLInputElement) inputEl.value = e.target
    open.value = true
  }

  // Ввод в поле всегда показывает список заново, даже после выбора или Escape.
  const trackInput = openSuggestions

  function onDocumentPointerDown(e: Event) {
    if (!open.value) return
    const target = e.target
    if (
      target instanceof Element &&
      (target.closest('[data-car-input]') || target.closest('[data-car-suggestions]'))
    )
      return
    open.value = false
  }

  let tapOrigin: { x: number; y: number } | null = null

  function onItemPointerDown(e: PointerEvent, index: number) {
    tapOrigin = { x: e.clientX, y: e.clientY }
    activeIndex.value = index
  }

  function onItemPointerUp(e: PointerEvent, car: string) {
    const origin = tapOrigin
    tapOrigin = null
    if (!origin) return
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > CAR_TAP_SLOP_PX) return
    select(car)
  }

  function scrollActiveIntoView() {
    requestAnimationFrame(() => {
      const el = listEl.value?.querySelector<HTMLElement>('[data-active="true"]')
      el?.scrollIntoView({ block: 'nearest' })
    })
  }

  function onKeydown(e: KeyboardEvent) {
    const list = filtered.value
    if (e.key === 'ArrowDown') {
      if (!open.value && list.length) open.value = true
      if (!list.length) return
      e.preventDefault()
      activeIndex.value = (activeIndex.value + 1) % list.length
      scrollActiveIntoView()
    } else if (e.key === 'ArrowUp') {
      if (!list.length) return
      e.preventDefault()
      activeIndex.value = (activeIndex.value - 1 + list.length) % list.length
      scrollActiveIntoView()
    } else if (e.key === 'Enter') {
      if (!open.value || !list.length) return
      e.preventDefault()
      const picked = list[activeIndex.value]
      if (picked) select(picked)
    } else if (e.key === 'Escape') {
      if (!open.value) return
      e.preventDefault()
      open.value = false
    }
  }

  onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))
  onUnmounted(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true))

  return {
    open,
    activeIndex,
    listEl,
    filtered,
    openSuggestions,
    trackInput,
    onItemPointerDown,
    onItemPointerUp,
    onKeydown,
  }
}
