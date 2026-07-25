import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = '50mm Retina World'

interface Props {
  fullName?: string
  deletedAt?: string // ISO date string of when the deletion was executed
}

/**
 * Deletion-of-account confirmation ("proof of erasure" notice).
 *
 * Sent AFTER the account and its personal data have been permanently deleted,
 * to the email address the account was registered under. Serves as the user's
 * written confirmation that erasure was carried out, and states exactly what
 * (if anything) is retained and on what legal basis. The corresponding
 * email_send_log row is the platform's own record that this notice was issued.
 */
const AccountDeletedEmail = ({ fullName, deletedAt }: Props) => {
  const dateText = deletedAt
    ? new Date(deletedAt).toUTCString().replace(' GMT', ' (UTC)')
    : 'today'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Confirmation: your account and personal data have been deleted</Preview>
      <Body style={main}>
        <Container style={container}>
          <BrandHeader />
          <Heading style={h1}>{fullName ? `Hi ${fullName},` : 'Hi,'}</Heading>
          <Text style={label}>Account Deletion Confirmation</Text>
          <Text style={text}>
            This email confirms that your {SITE_NAME} account was{' '}
            <strong>permanently deleted</strong> on <strong>{dateText}</strong>,
            and that the personal data associated with it has been erased from
            our systems.
          </Text>
          <Section style={box}>
            <Text style={boxLabel}>What was deleted</Text>
            <Text style={boxText}>
              Your profile and login credentials; your photos, competition
              entries, posts, comments, reactions and stories; your followers,
              friendships and referral links; your certificates, badges, wallet
              and notification history; your saved preferences, devices and
              personal details (including date of birth, contact and bank
              details).
            </Text>
          </Section>
          <Section style={box}>
            <Text style={boxLabel}>What is retained, and why</Text>
            <Text style={boxText}>
              Financial transaction and audit records are retained only to the
              extent required by applicable law (for example tax and accounting
              obligations), and this deletion notice itself is logged as proof
              that your request was carried out. These records are no longer
              used for any other purpose.
            </Text>
          </Section>
          <Text style={text}>
            This action is <strong>irreversible</strong> — the account and its
            data cannot be restored. You are welcome to create a new account at
            any time.
          </Text>
          <Text style={text}>
            <strong>If you did not request this deletion</strong>, please
            contact us immediately by replying to this email or via the Help
            &amp; Support page at https://50mmretina.com/help-support so we can
            investigate.
          </Text>
          <Hr style={hr} />
          <Text style={footer}>— The {SITE_NAME} Team</Text>
          <Disclaimer />
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: AccountDeletedEmail,
  subject: `Your account has been deleted — ${SITE_NAME}`,
  displayName: 'Account deleted (erasure confirmation)',
  previewData: {
    fullName: 'Alex',
    deletedAt: '2026-07-25T10:30:00Z',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 8px' }
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '1.6', color: '#333333', margin: '0 0 18px' }
const box: React.CSSProperties = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '16px 18px', margin: '0 0 22px' }
const boxLabel: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }
const boxText: React.CSSProperties = { fontSize: '14px', lineHeight: '1.55', color: '#1f2937', margin: '0' }
const hr: React.CSSProperties = { borderColor: '#eeeeee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999999', margin: '0' }
