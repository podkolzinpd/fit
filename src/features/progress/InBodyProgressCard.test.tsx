import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import { InBodyProgressCard } from './InBodyProgressCard'

const entries: ProgressEntry[] = [
  { id: '2', clientId: 'c', createdBy: 'c', recordedOn: localDate('2026-10-02'), customMetrics: [], version: 1,
    inBody: { schemaVersion: 1, skeletalMuscleMassKg: 24.2, bodyFatPercent: 20.1 } },
  { id: '1', clientId: 'c', createdBy: 'c', recordedOn: localDate('2026-09-02'), customMetrics: [], version: 1,
    inBody: { schemaVersion: 1, skeletalMuscleMassKg: 23.5, bodyFatPercent: 21.4 } },
]

describe('InBodyProgressCard', () => {
  it('shows the latest measurement and progress from the prior InBody report', () => {
    render(<InBodyProgressCard entries={entries} />)
    expect(screen.getByRole('heading', { name: 'Актуальный InBody' })).toBeVisible()
    expect(screen.getByText('+0,7 кг к 2 сентября 2026 г.')).toBeVisible()
    expect(screen.getByText('−1,3 % к 2 сентября 2026 г.')).toBeVisible()
  })
})
