/**
 * Needs Review — Submit RAW by Email Reply
 *
 * Sent to a participant when the admin publishes a round in which one or
 * more of the participant's photos has been flagged "Needs Review" by the
 * judges (Spec v3 §1.2 / §2.4 / §3.3 / §4.2).
 *
 * The participant is asked to REPLY DIRECTLY to this email with the original
 * RAW / source file attached. There is no upload page — communication is
 * email-only by product policy.
 */
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'
import { labelForStageKey } from '../stageCatalog.ts'

const SITE_NAME = '50mm Retina World'

interface Props {
  participantName?: string
  competitionTitle?: string
  roundNumber?: number
  photoLabels?: string
  /** Plan Phase 6 / Task 6.1 — canonical v3 stage_key (typically 'r1_needs_verification'). */
  stageKey?: string
  supportEmail?: string
}

const NeedsReviewSubmitRawEmail = ({
  participantName,
  competitionTitle,
  roundNumber,
  photoLabels,
  stageKey,
  supportEmail,
}: Props) => {
  const reply = supportEmail || 'support@50mmretina.com'
  // Canonical label sourced from v3_stage_catalog. Falls back to the legacy
  // English wording if the trigger hasn't been upgraded to emit a stage_key.
  const canonicalLabel = labelForStageKey(stageKey) ?? 'Verification Required'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{canonicalLabel} — reply with the RAW file</Preview>
      <Body style={main}>
        <Container style={container}>
          <BrandHeader />
          <Heading style={h1}>
            {participantName ? `Hi ${participantName},` : 'Hi,'}
          </Heading>
          <Text style={badge}>{canonicalLabel}</Text>
          <Text style={text}>
            The judges of <strong>{competitionTitle ?? 'your competition'}</strong>{' '}
            have flagged one or more of your photos for additional review during{' '}
            <strong>Round {roundNumber ?? '?'}</strong>
            {photoLabels ? <> ({photoLabels})</> : null}.
          </Text>
          <Section style={callout}>
            <Text style={calloutText}>
              <strong>What you need to do:</strong> simply <strong>reply to this email</strong>{' '}
              and attach the original / RAW source file(s) for the flagged photo(s).
              Please include the photo number(s) in your reply so the team can match
              the files to your entry.
            </Text>
          </Section>
          <Text style={text}>
            If your email provider blocks large attachments, you can also send a
            download link (Google Drive, Dropbox, WeTransfer, etc.) in your reply —
            anything that lets the team open the original capture is fine.
          </Text>
          <Text style={textSmall}>
            Replies go to <strong>{reply}</strong>. Your entry stays in the
            competition while the team reviews your file. There is nothing else
            to do in the app.
          </Text>
          <Text style={footer}>— The {SITE_NAME} Judging Team</Text>
                <Disclaimer />
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: NeedsReviewSubmitRawEmail,
  subject: (data: Record<string, any>) => {
    const lbl = labelForStageKey(data?.stageKey) ?? 'Verification Required'
    return `${lbl}: send the original RAW file${data?.competitionTitle ? ` for "${data.competitionTitle}"` : ''}`
  },
  displayName: 'Needs Review — Submit RAW by reply',
  previewData: {
    participantName: 'Alex',
    competitionTitle: 'Street Photography 2026',
    roundNumber: 1,
    photoLabels: 'Photo 2',
    stageKey: 'r1_needs_verification',
    supportEmail: 'support@50mmretina.com',
  },
} satisfies TemplateEntry


const main: React.CSSProperties = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}
const container: React.CSSProperties = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '32px 28px',
}
const h1: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#0a0a0a',
  margin: '0 0 20px',
  letterSpacing: '-0.01em',
}
const text: React.CSSProperties = {
  fontSize: '15px',
  lineHeight: '1.6',
  color: '#333333',
  margin: '0 0 18px',
}
const textSmall: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: '1.6',
  color: '#666666',
  margin: '20px 0 0',
}
const callout: React.CSSProperties = {
  backgroundColor: '#fff8e6',
  border: '1px solid #f5d27a',
  borderRadius: '6px',
  padding: '14px 16px',
  margin: '16px 0 22px',
}
const calloutText: React.CSSProperties = {
  fontSize: '14px',
  lineHeight: '1.6',
  color: '#3a2a00',
  margin: 0,
}
const footer: React.CSSProperties = {
  fontSize: '12px',
  color: '#999999',
  margin: '32px 0 0',
  borderTop: '1px solid #eeeeee',
  paddingTop: '16px',
}
const badge: React.CSSProperties = {
  display: 'inline-block',
  fontSize: '11px',
  fontWeight: 700,
  color: '#b45309',
  backgroundColor: '#fef3c7',
  border: '1px solid #fde68a',
  borderRadius: '4px',
  padding: '4px 10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  margin: '0 0 16px',
}
