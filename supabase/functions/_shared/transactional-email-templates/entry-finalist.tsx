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
  /** Plan Phase 6 / Task 6.1 — canonical v3 stage_key (typically 'r4_finalist'). */
  stageKey?: string
  entryUrl?: string
}

const EntryFinalistEmail = ({
  participantName, entryTitle, competitionTitle, stageKey, entryUrl,
}: Props) => {
  const canonicalLabel = labelForStageKey(stageKey) ?? 'Finalist'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{canonicalLabel} — {competitionTitle ?? 'the competition'}</Preview>
      <Body style={main}>
        <Container style={container}>
          <BrandHeader />
          <Heading style={h1}>{participantName ? `Outstanding, ${participantName}!` : 'Outstanding!'}</Heading>
          <Text style={label}>{canonicalLabel}</Text>
          <Text style={text}>
            Your entry {entryTitle ? <strong>"{entryTitle}"</strong> : 'your entry'} in{' '}
            <strong>{competitionTitle ?? 'the competition'}</strong> has been recognised as a{' '}
            <strong>{canonicalLabel}</strong>. You're now in the final round of judging
            alongside the strongest work submitted to this competition.
          </Text>
          <Text style={text}>
            Final results — including award placements — will be announced once the
            final round of judging concludes.
          </Text>
          <Section style={ctaSection}>
            <Button href={entryUrl ?? 'https://www.50mmretina.com/dashboard'} style={button}>
              View Your Finalist Entry
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
  component: EntryFinalistEmail,
  subject: (d: Record<string, any>) => {
    const lbl = labelForStageKey(d?.stageKey) ?? 'Finalist'
    return `🏆 ${lbl}${d?.entryTitle ? ` — "${d.entryTitle}"` : ''} — ${SITE_NAME}`
  },
  displayName: 'Entry finalist',
  previewData: {
    participantName: 'Alex',
    entryTitle: 'Morning Light',
    competitionTitle: 'Street Photography 2026',
    stageKey: 'r4_finalist',
    entryUrl: 'https://www.50mmretina.com/dashboard',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 8px' }
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#d97706', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '1.6', color: '#333333', margin: '0 0 18px' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#ffffff', padding: '12px 28px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '6px', textTransform: 'uppercase', letterSpacing: '0.02em' }
const hr: React.CSSProperties = { borderColor: '#eeeeee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999999', margin: '0' }
