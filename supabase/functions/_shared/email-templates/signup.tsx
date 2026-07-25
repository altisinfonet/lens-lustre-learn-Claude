/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
  token?: string
}

const LOGO_URL = 'https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/email-assets/logo.png'

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl, token }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {siteName} verification code{token ? ` is ${token}` : ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt={siteName} width="48" height="48" style={logo} />
        <Heading style={h1}>Welcome to {siteName}</Heading>
        <Text style={text}>
          Thanks for joining <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>!
          Enter this code on the site to confirm your email ({recipient}):
        </Text>
        {token ? (
          <>
            <Text style={code}>{token}</Text>
            <Text style={codeHint}>This code expires in 1 hour. If you didn't request it, ignore this email.</Text>
            <Text style={orText}>Or click the button below to confirm:</Text>
          </>
        ) : null}
        <Button style={button} href={confirmationUrl}>Verify Email</Button>
        <Text style={footer}>If you didn't create an account, you can safely ignore this email.</Text>
              <Text style={disclaimer}>This is an automated message from <strong>50mm Retina World</strong>. Please do not reply — this inbox is not monitored.</Text>
        <Text style={disclaimer}>Need help or spotted an issue? Sign in to your account and raise a support ticket from the <strong>Help &amp; Support</strong> section — our team will get back to you as quickly as possible.</Text>
        </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }
const container = { padding: '40px 25px' }
const logo = { margin: '0 0 24px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1f2e', margin: '0 0 20px', letterSpacing: '-0.01em' }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.6', margin: '0 0 25px' }
const link = { color: '#0ea5e9', textDecoration: 'underline' }
const button = { backgroundColor: '#0ea5e9', color: '#0c2d3f', fontSize: '13px', fontWeight: 'bold' as const, borderRadius: '0px', padding: '14px 28px', textDecoration: 'none', letterSpacing: '0.05em', textTransform: 'uppercase' as const }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
const disclaimer = { fontSize: '11px', color: '#9ca3af', lineHeight: '1.6', margin: '16px 0 0' }
const code = { fontSize: '34px', fontWeight: 'bold' as const, color: '#0c2d3f', letterSpacing: '0.35em', margin: '8px 0 6px', textAlign: 'center' as const, backgroundColor: '#f1f5f9', padding: '16px 0', borderRadius: '6px' }
const codeHint = { fontSize: '11px', color: '#9ca3af', margin: '0 0 22px', textAlign: 'center' as const }
const orText = { fontSize: '12px', color: '#55575d', margin: '0 0 12px' }
