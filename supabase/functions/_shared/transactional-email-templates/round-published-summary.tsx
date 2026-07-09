import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = '50mm Retina World'

interface Props {
  participantName?: string
  competitionTitle?: string
  roundNumber?: number
  entriesAdvanced?: number
  entriesNotAdvanced?: number
  totalEntries?: number
  dashboardUrl?: string
}

const RoundPublishedSummaryEmail = ({
  participantName, competitionTitle, roundNumber, entriesAdvanced, entriesNotAdvanced, totalEntries, dashboardUrl,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Round ${roundNumber ?? '?'} results published — ${competitionTitle ?? SITE_NAME}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>{participantName ? `Hi ${participantName},` : 'Hi,'}</Heading>
        <Text style={label}>Round {roundNumber ?? '?'} results published</Text>
        <Text style={text}>
          The results for <strong>Round {roundNumber ?? '?'}</strong> of{' '}
          <strong>{competitionTitle ?? 'the competition'}</strong> have been published.
        </Text>
        {(typeof entriesAdvanced === 'number' || typeof totalEntries === 'number') && (
          <Section style={statsBox}>
            {typeof entriesAdvanced === 'number' && (
              <Text style={statLine}>
                <strong>Your entries advanced:</strong> {entriesAdvanced}
              </Text>
            )}
            {typeof entriesNotAdvanced === 'number' && (
              <Text style={statLine}>
                <strong>Your entries not advanced:</strong> {entriesNotAdvanced}
              </Text>
            )}
            {typeof totalEntries === 'number' && (
              <Text style={statLine}>
                <strong>Your total entries in this round:</strong> {totalEntries}
              </Text>
            )}
          </Section>
        )}
        <Text style={text}>
          Visit your dashboard to see per-entry decisions, judge feedback, and any
          next steps.
        </Text>
        <Section style={ctaSection}>
          <Button href={dashboardUrl ?? 'https://www.50mmretina.com/dashboard'} style={button}>
            View Round Results
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>— The {SITE_NAME} Judging Team</Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: RoundPublishedSummaryEmail,
  subject: (d: Record<string, any>) =>
    `Round ${d?.roundNumber ?? ''} results published — ${d?.competitionTitle ?? SITE_NAME}`,
  displayName: 'Round published — participant summary',
  previewData: {
    participantName: 'Alex',
    competitionTitle: 'Street Photography 2026',
    roundNumber: 2,
    entriesAdvanced: 2,
    entriesNotAdvanced: 1,
    totalEntries: 3,
    dashboardUrl: 'https://www.50mmretina.com/dashboard',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 8px' }
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#0284c7', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '1.6', color: '#333333', margin: '0 0 18px' }
const statsBox: React.CSSProperties = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px', margin: '0 0 20px' }
const statLine: React.CSSProperties = { fontSize: '14px', lineHeight: '1.5', color: '#1f2937', margin: '0 0 6px' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#ffffff', padding: '12px 28px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '6px', textTransform: 'uppercase', letterSpacing: '0.02em' }
const hr: React.CSSProperties = { borderColor: '#eeeeee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999999', margin: '0' }
