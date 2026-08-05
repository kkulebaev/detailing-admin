import type { AnalyticsOverviewResponse } from '@detailing-admin/shared'
import { unwrap } from './api-client'
import { getApiAnalyticsOverview } from './generated/analytics/analytics'
import type { GetApiAnalyticsOverviewParams } from './generated/model'

export type { AnalyticsOverviewResponse, GetApiAnalyticsOverviewParams }

export function fetchAnalyticsOverview(
  params: GetApiAnalyticsOverviewParams,
): Promise<AnalyticsOverviewResponse> {
  return unwrap<AnalyticsOverviewResponse>(() => getApiAnalyticsOverview(params))
}
