import { computed, ref } from 'vue'

// reka-ui Pagination speaks 1-based page numbers; the list queries are
// offset-based. This bridges the two so the list pages share one paging
// contract (the "N–M из total" range is derived in TablePagination).
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
