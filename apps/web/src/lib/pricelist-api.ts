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
import { unwrap } from './api-client'
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
  countable: boolean
  priceClass1Min: number
  priceClass1Max: number | null
  priceClass2Min: number
  priceClass2Max: number | null
  priceClass3Min: number
  priceClass3Max: number | null
  priceClass4Min: number
  priceClass4Max: number | null
}

export function fetchPricelist(): Promise<PricelistApiResult> {
  return unwrap<PricelistApiResult>(() => getApiPricelist())
}

export function createSection(payload: SectionInputPayload): Promise<SectionMutationResult> {
  return unwrap<SectionMutationResult>(() => postApiPricelistSections(payload))
}

export function updateSection(
  id: number,
  payload: SectionInputPayload,
): Promise<SectionMutationResult> {
  return unwrap<SectionMutationResult>(() => patchApiPricelistSectionsId(String(id), payload))
}

export function deleteSection(id: number): Promise<PricelistDeleteResult> {
  return unwrap<PricelistDeleteResult>(() => deleteApiPricelistSectionsId(String(id)))
}

export function createService(payload: ServiceInputPayload): Promise<ServiceMutationResult> {
  return unwrap<ServiceMutationResult>(() => postApiPricelistServices(payload))
}

export function updateService(
  id: number,
  payload: ServiceInputPayload,
): Promise<ServiceMutationResult> {
  return unwrap<ServiceMutationResult>(() => patchApiPricelistServicesId(String(id), payload))
}

export function deleteService(id: number): Promise<PricelistDeleteResult> {
  return unwrap<PricelistDeleteResult>(() => deleteApiPricelistServicesId(String(id)))
}
