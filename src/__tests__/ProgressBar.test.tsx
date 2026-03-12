import React from 'react';
import { render } from '@testing-library/react-native';
import { ProgressBar } from '../components/ui/ProgressBar';

describe('ProgressBar', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<ProgressBar value={50} />);
    expect(toJSON()).toBeTruthy();
  });

  it('shows percentage when showPercent is true', () => {
    const { getByText } = render(<ProgressBar value={3} max={10} showPercent />);
    expect(getByText('30%')).toBeTruthy();
  });

  it('shows label when provided', () => {
    const { getByText } = render(<ProgressBar value={5} label="5 of 10" />);
    expect(getByText('5 of 10')).toBeTruthy();
  });

  it('clamps to 100% for over-values', () => {
    const { getByText } = render(<ProgressBar value={150} max={100} showPercent />);
    expect(getByText('100%')).toBeTruthy();
  });

  it('shows 0% when value is 0', () => {
    const { getByText } = render(<ProgressBar value={0} max={10} showPercent />);
    expect(getByText('0%')).toBeTruthy();
  });
});
