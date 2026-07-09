import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'
import { labelForStageKey } from '../stageCatalog.ts'

const SITE_NAME = '50mm Retina World'

/**
 * Plan Phase 6 / Task 6.1 — All R4 award labels are sourced from
 * `v3_stage_catalog.tag_label_canonical` via `labelForStageKey()`. The
 * legacy `placement` prop ('winner' / 'runner_up' / 'honorable_mention')
 * is mapped to the corresponding stage_key for back-compat with the
 * pre-Phase-6 trigger payload.
 */
const PLACEMENT_TO_STAGE_KEY: Record<string, string> = {
  winner:             'r4_winner',
  runner_up:          'r4_runner_up_1',
  runner_up_1:        'r4_runner_up_1',
  runner_up_2:        'r4_runner_up_2',
  honorable_mention:  'r4_honorary_mention',
  honourable_mention: 'r4_honorary_mention',
  honorary_mention:   'r4_honorary_mention',
  special_jury:       'r4_special_jury',
  top_50:             'r4_top_50',
  top_100:            'r4_top_100',
  finalist:           'r4_finalist',
}

const EMOJI_BY_STAGE_KEY: Record<string, string> = {
  r4_winner:           '🥇',
  r4_runner_up_1:      '🥈',
  r4_runner_up_2:      '🥉',
  r4_honorary_mention: '🎖️',
  r4_special_jury:     '🏅',
  r4_top_50:           '🌟',
  r4_top_100:          '⭐',
  r4_finalist:         '🏆',
}

function resolveStageKey(d: { stageKey?: string; placement?: string }): string {
  if (d.stageKey && d.stageKey in EMOJI_BY_STAGE_KEY) return d.stageKey
  if (d.placement && PLACEMENT_TO_STAGE_KEY[d.placement]) return PLACEMENT_TO_STAGE_KEY[d.placement]
  return 'r4_winner'
}

interface Props {
  participantName?: string
  entryTitle?: string
  competitionTitle?: string
  /** Plan Phase 6 — canonical v3 stage_key (e.g. 'r4_top_50'). */
  stageKey?: string
  /** Legacy back-compat input — mapped to stage_key when stageKey is absent. */
  placement?: string
  certificateUrl?: string
  entryUrl?: string
}

const EntryWinnerEmail = ({
  participantName, entryTitle, competitionTitle, stageKey, placement, certificateUrl, entryUrl,
}: Props) => {
  const resolved = resolveStageKey({ stageKey, placement })
  const label = labelForStageKey(resolved) ?? 'Award'
  const emoji = EMOJI_BY_STAGE_KEY[resolved] ?? '🏆'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{emoji} {label} — {competitionTitle ?? SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <BrandHeader />
          <Heading style={h1}>
            {participantName ? `Congratulations, ${participantName}!` : 'Congratulations!'}
          </Heading>
          <Text style={label_style}>{emoji} {label}</Text>
          <Text style={text}>
            Your entry {entryTitle ? <strong>"{entryTitle}"</strong> : 'your entry'} has
            been awarded <strong>{label}</strong> in{' '}
            <strong>{competitionTitle ?? 'the competition'}</strong>.
          </Text>
          <Text style={text}>
            This is a remarkable achievement. Thank you for sharing your craft with
            the {SITE_NAME} community.
          </Text>
          <Section style={ctaSection}>
            <Button href={certificateUrl ?? entryUrl ?? 'https://www.50mmretina.com/dashboard'} style={button}>
              {certificateUrl ? 'View Your Certificate' : 'View Your Award'}
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
  component: EntryWinnerEmail,
  subject: (d: Record<string, any>) => {
    const resolved = resolveStageKey({ stageKey: d?.stageKey, placement: d?.placement })
    const lbl = labelForStageKey(resolved) ?? 'Award'
    const emo = EMOJI_BY_STAGE_KEY[resolved] ?? '🏆'
    return `${emo} ${lbl}${d?.entryTitle ? ` — "${d.entryTitle}"` : ''} — ${SITE_NAME}`
  },
  displayName: 'Entry award (R4 placements)',
  previewData: {
    participantName: 'Alex',
    entryTitle: 'Morning Light',
    competitionTitle: 'Street Photography 2026',
    stageKey: 'r4_winner',
    certificateUrl: 'https://www.50mmretina.com/dashboard?certificate=demo',
    entryUrl: 'https://www.50mmretina.com/dashboard',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1: React.CSSProperties = { fontSize: '24px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 8px' }
const label_style: React.CSSProperties = { fontSize: '13px', fontWeight: 700, color: '#b45309', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '1.6', color: '#333333', margin: '0 0 18px' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#ffffff', padding: '12px 28px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '6px', textTransform: 'uppercase', letterSpacing: '0.02em' }
const hr: React.CSSProperties = { borderColor: '#eeeeee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999999', margin: '0' }
