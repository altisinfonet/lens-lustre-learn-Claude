/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as notificationAlert } from './notification-alert.tsx'
import { template as entryShortlisted } from './entry-shortlisted.tsx'
import { template as entryQualifiedRound } from './entry-qualified-round.tsx'
import { template as entryRejected } from './entry-rejected.tsx'
import { template as entryFinalist } from './entry-finalist.tsx'
import { template as entryWinner } from './entry-winner.tsx'
import { template as roundPublishedSummary } from './round-published-summary.tsx'
import { template as needsReviewSubmitRaw } from './needs-review-submit-raw.tsx'
import { template as certificateRevoked } from './certificate-revoked.tsx'
import { template as reengagementDay3 } from './reengagement-day-3.tsx'
import { template as reengagementDay7 } from './reengagement-day-7.tsx'
import { template as reengagementDay15 } from './reengagement-day-15.tsx'
import { template as reengagementDay30 } from './reengagement-day-30.tsx'
import { template as reengagementDay40 } from './reengagement-day-40.tsx'
import { template as reengagementDay50 } from './reengagement-day-50.tsx'
import { template as reengagementDay60 } from './reengagement-day-60.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'notification-alert': notificationAlert,
  'entry-shortlisted': entryShortlisted,
  'entry-qualified-round': entryQualifiedRound,
  'entry-rejected': entryRejected,
  'entry-finalist': entryFinalist,
  'entry-winner': entryWinner,
  'round-published-summary': roundPublishedSummary,
  'needs-review-submit-raw': needsReviewSubmitRaw,
  'certificate-revoked': certificateRevoked,
  'reengagement-day-3': reengagementDay3,
  'reengagement-day-7': reengagementDay7,
  'reengagement-day-15': reengagementDay15,
  'reengagement-day-30': reengagementDay30,
  'reengagement-day-40': reengagementDay40,
  'reengagement-day-50': reengagementDay50,
  'reengagement-day-60': reengagementDay60,
}
