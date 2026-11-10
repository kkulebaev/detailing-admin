import { computed, ref } from 'vue'

// Pagination из reka-ui работает с номерами страниц от 1, а запросы списков —
// со смещением. Этот мост даёт страницам списков один общий контракт пагинации
// (диапазон «N–M из total» вычисляется в TablePagination).
export function useOffsetPagination(limit = 50) {
  const offset = ref(0)

  const page = computed({
    get: () => Math.floor(offset.value / limit) + 1,
    set: (value) => {
      offset.value = Math.max(0, (value - 1) * limit)
    },
  })

  function resetToFirstPage() {
    offset.value = 0
  }

  return { limit, offset, page, resetToFirstPage }
}
