import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { downloadFile } from '@/lib/download'

function okBlobResponse(): Response {
  return {
    ok: true,
    status: 200,
    blob: () => Promise.resolve(new Blob(['a;b\r\n'], { type: 'text/csv' })),
  } as Response
}

function errorResponse(status: number): Response {
  return { ok: false, status, blob: () => Promise.resolve(new Blob()) } as Response
}

describe('downloadFile', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let createObjectURL: Mock<typeof URL.createObjectURL>
  let revokeObjectURL: Mock<typeof URL.revokeObjectURL>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    createObjectURL = vi.fn<typeof URL.createObjectURL>(() => 'blob:mock')
    revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('делает fetch с credentials, создаёт object URL и кликает по ссылке скачивания', async () => {
    fetchMock.mockResolvedValue(okBlobResponse())
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadFile('/api/bookings/export?master=Иван', 'bookings-2026-08-06.csv')

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/bookings/export?master=Иван'),
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    // После клика Blob освобождается.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
    // Временная ссылка не должна оставаться в DOM.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('бросает исключение на не-ok ответе и не запускает скачивание', async () => {
    fetchMock.mockResolvedValue(errorResponse(503))
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await expect(downloadFile('/api/clients/export', 'clients.csv')).rejects.toThrow()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
