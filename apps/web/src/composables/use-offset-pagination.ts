import { computed, ref, watch, type Ref } from 'vue'

// Pagination из reka-ui работает с номерами страниц от 1, а запросы списков —
// со смещением. Этот мост дает страницам списков один общий контракт пагинации
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

  // Страница из старой ссылки может оказаться за концом списка: без этого вместо
  // последних строк была бы пустая таблица с «Ничего не найдено».
  function keepWithin(total: Ref<number>) {
    // immediate: ответ может уже лежать в кеше, и тогда total не изменится.
    watch(
      total,
      (t) => {
        if (t > 0 && offset.value >= t) offset.value = (Math.ceil(t / limit) - 1) * limit
      },
      { immediate: true },
    )
  }

  return { limit, offset, page, resetToFirstPage, keepWithin }
}
