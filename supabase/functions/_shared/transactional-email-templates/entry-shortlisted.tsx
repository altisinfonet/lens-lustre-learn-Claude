import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'
import { labelForStageKey } from '../stageCatalog.ts'

const SITE_NAME = '50mm Retina World'

interface Props {
  participantName?: string
  entryTitle?: string
  competitionTitle?: string
  roundNumber?: number
  /** Plan Phase 6 / Task 6.1 — canonical v3 stage_key (e.g. 'r1_shortlisted_r2'). */
  stageKey?: string
  entryUrl?: string
}

const EntryShortlistedEmail = ({
  participantName, entryTitle, competitionTitle, roundNumber, stageKey, entryUrl,
}: Props) => {
  // Canonical label sourced from v3_stage_catalog (FALLBACK_ACTIVE mirror).
  const canonicalLabel = labelForStageKey(stageKey) ?? 'Shortlisted'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{canonicalLabel}{entryTitle ? ` — "${entryTitle}"` : ''}</Preview>
      <Body style={main}>
        <Container style={container}>
          <BrandHeader />
          <Heading style={h1}>{participantName ? `Congratulations, ${participantName}!` : 'Congratulations!'}</Heading>
          <Text style={label}>{canonicalLabel}{roundNumber ? ` — Round ${roundNumber}` : ''}</Text>
          <Text style={text}>
            Your entry {entryTitle ? <strong>"{entryTitle}"</strong> : 'your entry'} in{' '}
            <strong>{competitionTitle ?? 'the competition'}</strong> has been{' '}
            <strong>{canonicalLabel.toLowerCase()}</strong> by our judges. This is a recognition of the
            strength of your work.
          </Text>
          <Section style={ctaSection}>
            <Button href={entryUrl ?? 'https://www.50mmretina.com/dashboard'} style={button}>
              View Your Entry
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>— The {SITE_NAME} Judging Team</Text>
                <Disclaimer />
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: EntryShortlistedEmail,
  subject: (d: Record<string, any>) => {
    const lbl = labelForStageKey(d?.stageKey) ?? 'Shortlisted'
    return `🌟 ${lbl}${d?.entryTitle ? ` — "${d.entryTitle}"` : ''} — ${SITE_NAME}`
  },
  displayName: 'Entry shortlisted',
  previewData: {
    participantName: 'Alex',
    entryTitle: 'Morning Light',
    competitionTitle: 'Street Photography 2026',
    roundNumber: 1,
    stageKey: 'r1_shortlisted_r2',
    entryUrl: 'https://www.50mmretina.com/dashboard',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 8px' }
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#0284c7', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '1.6', color: '#333333', margin: '0 0 18px' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#ffffff', padding: '12px 28px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '6px', textTransform: 'uppercase', letterSpacing: '0.02em' }
const hr: React.CSSProperties = { borderColor: '#eeeeee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999999', margin: '0' }
