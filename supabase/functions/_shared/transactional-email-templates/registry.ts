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
import { template as reengagementDay6 } from './reengagement-day-6.tsx'
import { template as reengagementDay9 } from './reengagement-day-9.tsx'
import { template as reengagementDay12 } from './reengagement-day-12.tsx'

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
  'reengagement-day-6': reengagementDay6,
  'reengagement-day-9': reengagementDay9,
  'reengagement-day-12': reengagementDay12,
}
