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
import { parseResponse } from './api-client'
import {
  deleteApiPricelistSectionsId,
  deleteApiPricelistServicesId,
  getApiPricelist,
  patchApiPricelistSectionsId,
  patchApiPricelistServicesId,
  postApiPricelistSections,
  postApiPricelistServices,
} from './generated/pricelist/pricelist'

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
  return parseResponse(() => getApiPricelist(), pricelistListResponseSchema)
}

export function createSection(payload: SectionInputPayload): Promise<SectionMutationResult> {
  return parseResponse(
    () => postApiPricelistSections(payload),
    pricelistSectionMutationResponseSchema,
  )
}

export function updateSection(
  id: number,
  payload: SectionInputPayload,
): Promise<SectionMutationResult> {
  return parseResponse(
    () => patchApiPricelistSectionsId(String(id), payload),
    pricelistSectionMutationResponseSchema,
  )
}

export function deleteSection(id: number): Promise<PricelistDeleteResult> {
  return parseResponse(
    () => deleteApiPricelistSectionsId(String(id)),
    pricelistDeleteResponseSchema,
  )
}

export function createService(payload: ServiceInputPayload): Promise<ServiceMutationResult> {
  return parseResponse(
    () => postApiPricelistServices(payload),
    pricelistServiceMutationResponseSchema,
  )
}

export function updateService(
  id: number,
  payload: ServiceInputPayload,
): Promise<ServiceMutationResult> {
  return parseResponse(
    () => patchApiPricelistServicesId(String(id), payload),
    pricelistServiceMutationResponseSchema,
  )
}

export function deleteService(id: number): Promise<PricelistDeleteResult> {
  return parseResponse(
    () => deleteApiPricelistServicesId(String(id)),
    pricelistDeleteResponseSchema,
  )
}
