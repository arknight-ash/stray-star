import type { Metadata } from 'next';
import { LoginClient } from './LoginClient';

export const metadata: Metadata = {
  title: '登录',
};

export default function LoginPage() {
  return <LoginClient />;
}
