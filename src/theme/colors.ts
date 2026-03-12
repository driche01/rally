export const colors = {
  coral: {
    50: '#FFF5F4',
    100: '#FFE8E6',
    200: '#FFC4BF',
    300: '#FF9E97',
    400: '#FF7A70',
    500: '#FF6B5B',
    600: '#F04D3C',
    700: '#D93A29',
    800: '#B52E1F',
    900: '#8C2317',
  },
  neutral: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E8E8E8',
    300: '#D1D1D1',
    400: '#A8A8A8',
    500: '#717171',
    600: '#4A4A4A',
    700: '#3A3A3A',
    800: '#222222',
    900: '#111111',
  },
  success: '#00A699',
  warning: '#FFB400',
  error: '#C13515',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export type ColorKey = keyof typeof colors;
