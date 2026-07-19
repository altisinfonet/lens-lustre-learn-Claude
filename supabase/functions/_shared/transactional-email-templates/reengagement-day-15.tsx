import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = '50mm Retina World'
const SITE_URL = 'https://www.50mmretina.com'

interface Props {
  participantName?: string
  newPostsCount?: number
  activeCompetitions?: number
  friendsActive?: number
}

// Day-15 — Warm direct
const Email = ({ participantName, newPostsCount = 0, activeCompetitions = 0, friendsActive = 0 }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>We miss your work{participantName ? `, ${participantName}` : ''}.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>We miss your work{participantName ? `, ${participantName}` : ''}.</Heading>
        <Text style={text}>
          That's the honest version. No tricks, no countdowns. The community you joined is more interesting when you're in it.
        </Text>
        <Text style={text}>
          A small snapshot of what's happened over the last couple of weeks:
        </Text>
        <Section style={statBox}>
          {newPostsCount > 0 && <Text style={statLine}><strong>{newPostsCount}</strong> new photos from photographers you follow</Text>}
          {friendsActive > 0 && <Text style={statLine}><strong>{friendsActive}</strong> friends are active right now</Text>}
          {activeCompetitions > 0 && <Text style={statLine}><strong>{activeCompetitions}</strong> open competitions with cash prizes</Text>}
        </Section>
        <Text style={text}>
          If you're stuck for inspiration — start small. One photo. One caption. The rest follows.
        </Text>
        <Section style={ctaSection}>
          <Button href={`${SITE_URL}/feed`} style={button}>Come Back to the Feed</Button>
        </Section>
        <Text style={ps}>
          Not feeling it? <a href={`${SITE_URL}/notifications`} style={link}>Adjust your email preferences</a> — we'll respect your space.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>— The {SITE_NAME} Team</Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `We miss your work${d?.participantName ? `, ${d.participantName}` : ''} · 50mm Retina World`,
  displayName: 'Re-engagement · Day 15 (warm direct)',
  previewData: { participantName: 'Alex', newPostsCount: 124, activeCompetitions: 4, friendsActive: 15 },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 600, color: '#0a0a0a', margin: '0 0 18px', lineHeight: 1.4 }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: 1.7, color: '#333', margin: '0 0 16px' }
const statBox: React.CSSProperties = { backgroundColor: '#f8fafc', padding: '20px 24px', borderRadius: '8px', margin: '20px 0' }
const statLine: React.CSSProperties = { fontSize: '14px', color: '#0a0a0a', margin: '6px 0' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0 16px' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#fff', padding: '13px 30px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '6px' }
const link: React.CSSProperties = { color: '#0284c7', textDecoration: 'underline' }
const ps: React.CSSProperties = { fontSize: '12px', color: '#666', margin: '18px 0 0' }
const hr: React.CSSProperties = { borderColor: '#eee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999' }
