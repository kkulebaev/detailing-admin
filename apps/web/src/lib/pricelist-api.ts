import { z } from 'zod'
import {
  pricelistDeleteResponseSchema,
  pricelistListResponseSchema,
  pricelistSectionMutationResponseSchema,
  pricelistServiceMutationResponseSchema,
  type PricelistSection,
  type PricelistSectionRow,
  type PricelistService,
} from '@detailing-admin/shared'
import { apiClient, parseResponse } from './api-client'

export type { PricelistSection, PricelistSectionRow, PricelistService }

export type PricelistApiResult = z.infer<typeof pricelistListResponseSchema>
export type SectionMutationResult = z.infer<typeof pricelistSectionMutationResponseSchema>
export type ServiceMutationResult = z.infer<typeof pricelistServiceMutationResponseSchema>
export type PricelistDeleteResult = z.infer<typeof pricelistDeleteResponseSchema>

export interface SectionInputPayload {
  name: string
}

export interface ServiceInputPayload {
  sectionId: number
  name: string
  description: string | null
  priceClass1: number | null
  priceClass2: number | null
  priceClass3: number | null
  priceClass4: number | null
}

export function fetchPricelist(): Promise<PricelistApiResult> {
  return parseResponse(() => apiClient.api.pricelist.$get(), pricelistListResponseSchema)
}

export function createSection(payload: SectionInputPayload): Promise<SectionMutationResult> {
  return parseResponse(
    () => apiClient.api.pricelist.sections.$post({ json: payload }),
    pricelistSectionMutationResponseSchema,
  )
}

export function updateSection(
  id: number,
  payload: SectionInputPayload,
): Promise<SectionMutationResult> {
  return parseResponse(
    () =>
      apiClient.api.pricelist.sections[':id'].$patch({
        param: { id: String(id) },
        json: payload,
      }),
    pricelistSectionMutationResponseSchema,
  )
}

export function deleteSection(id: number): Promise<PricelistDeleteResult> {
  return parseResponse(
    () => apiClient.api.pricelist.sections[':id'].$delete({ param: { id: String(id) } }),
    pricelistDeleteResponseSchema,
  )
}

export function createService(payload: ServiceInputPayload): Promise<ServiceMutationResult> {
  return parseResponse(
    () => apiClient.api.pricelist.services.$post({ json: payload }),
    pricelistServiceMutationResponseSchema,
  )
}

export function updateService(
  id: number,
  payload: ServiceInputPayload,
): Promise<ServiceMutationResult> {
  return parseResponse(
    () =>
      apiClient.api.pricelist.services[':id'].$patch({
        param: { id: String(id) },
        json: payload,
      }),
    pricelistServiceMutationResponseSchema,
  )
}

export function deleteService(id: number): Promise<PricelistDeleteResult> {
  return parseResponse(
    () => apiClient.api.pricelist.services[':id'].$delete({ param: { id: String(id) } }),
    pricelistDeleteResponseSchema,
  )
}
