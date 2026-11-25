import { describe, expect, it } from 'vitest';
import { isPrivateIp, parseIPv6 } from './ip';

describe('parseIPv6', () => {
  it('expands compressed forms and embedded IPv4', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('2001:db8::8a2e:370:7334')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0x8a2e, 0x370, 0x7334]);
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
    expect(parseIPv6('[fe80::1%eth0]')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });
  it('rejects garbage', () => {
    expect(parseIPv6('not-an-ip')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('127.0.0.1')).toBeNull();
  });
});

describe('isPrivateIp — IPv4', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1', // CGNAT
    '100.127.255.254',
    '127.0.0.1',
    '127.53.0.1',
    '169.254.169.254', // cloud metadata
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1', // multicast
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '129.187.255.227'])(
    'allows public %s',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );
});

describe('isPrivateIp — IPv6', () => {
  it.each([
    '::', // unspecified
    '::1', // loopback
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:8.8.8.8', // IPv4-mapped is always blocked
    '::ffff:7f00:1',
    '::127.0.0.1', // IPv4-compatible
    'fc00::1', // ULA
    'fd12:3456:789a::1',
    'fe80::1', // link-local
    'fe80::1%eth0',
    'febf::1',
    'fec0::1', // site-local
    'ff02::1', // multicast
    '64:ff9b::10.0.0.1', // NAT64 of a private address
    '64:ff9b:1::1', // local-use NAT64
    '100::1', // discard-only
    '2001:db8::1', // documentation
    '2001::1', // Teredo
    '2002:c0a8:0101::1', // 6to4 of 192.168.1.1
    '3fff::1', // documentation
    '::2', // outside 2000::/3
  ])('blocks %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['2a00:1450:4001:80b::200e', '2606:4700:4700::1111', '64:ff9b::8.8.8.8', '2002:0808:0808::1'])(
    'allows public %s',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );

  it('fails closed on non-IP input', () => {
    expect(isPrivateIp('localhost')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
    expect(isPrivateIp('999.1.1.1')).toBe(true);
  });
});
