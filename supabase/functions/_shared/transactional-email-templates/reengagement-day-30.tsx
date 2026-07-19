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

// Day-30 — One month milestone / "here's what changed"
const Email = ({ participantName, newPostsCount = 0, activeCompetitions = 0, friendsActive = 0 }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>It's been a month — here's what you've missed.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Text style={kicker}>· One month on ·</Text>
        <Heading style={h1}>A lot can change in 30 days{participantName ? `, ${participantName}` : ''}.</Heading>
        <Text style={text}>
          It's been about a month since we last saw you on {SITE_NAME}. No guilt trip — life gets busy. We just wanted to show you what the community has been up to while you were away.
        </Text>
        <Section style={statBox}>
          {newPostsCount > 0 && <Text style={statLine}><strong>{newPostsCount}</strong> new photos shared this past month</Text>}
          {activeCompetitions > 0 && <Text style={statLine}><strong>{activeCompetitions}</strong> competitions are open right now — with prizes still up for grabs</Text>}
          {friendsActive > 0 && <Text style={statLine}><strong>{friendsActive}</strong> photographers were active in the last day alone</Text>}
        </Section>
        <Text style={text}>
          Your profile, your portfolio, and everything you've earned are exactly where you left them. Picking back up takes one tap.
        </Text>
        <Section style={ctaSection}>
          <Button href={`${SITE_URL}/feed`} style={button}>See What's New</Button>
        </Section>
        <Text style={ps}>
          Prefer fewer emails? <a href={`${SITE_URL}/notifications`} style={link}>Update your preferences</a> anytime.
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
  subject: (d: Record<string, any>) => `A lot can change in 30 days${d?.participantName ? `, ${d.participantName}` : ''} · 50mm Retina World`,
  displayName: 'Re-engagement · Day 30 (one-month digest)',
  previewData: { participantName: 'Alex', newPostsCount: 312, activeCompetitions: 5, friendsActive: 21 },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const kicker: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.2em', color: '#0284c7', textTransform: 'uppercase', fontWeight: 600, margin: '0 0 10px' }
const h1: React.CSSProperties = { fontSize: '23px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 18px', lineHeight: 1.35 }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: 1.7, color: '#333', margin: '0 0 16px' }
const statBox: React.CSSProperties = { backgroundColor: '#f0f9ff', padding: '20px 24px', borderRadius: '10px', borderLeft: '3px solid #0284c7', margin: '22px 0' }
const statLine: React.CSSProperties = { fontSize: '14px', color: '#0a0a0a', margin: '6px 0' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0 16px' }
const button: React.CSSProperties = { backgroundColor: '#0284c7', color: '#fff', padding: '14px 32px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '8px' }
const link: React.CSSProperties = { color: '#0284c7', textDecoration: 'underline' }
const ps: React.CSSProperties = { fontSize: '12px', color: '#666', margin: '18px 0 0' }
const hr: React.CSSProperties = { borderColor: '#eee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999' }
