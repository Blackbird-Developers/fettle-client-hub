import { describe, expect, it } from 'vitest';
import {
    assessmentTherapistCalendarIds,
    isTherapistCalendar,
} from './assessments';

const PRELIM = 13216804;

describe('assessment therapist calendars', () => {
    it('drops the Preliminary Availability Calendar', () => {
        // Depression Assessment Screening's calendars in Acuity (Nov 2026).
        expect(
            assessmentTherapistCalendarIds([
                14385501, 14263454, 14081738, 14576827, PRELIM,
            ])
        ).toEqual([14385501, 14263454, 14081738, 14576827]);
    });

    it('treats a missing or prelim calendar as no therapist', () => {
        expect(isTherapistCalendar(null)).toBe(false);
        expect(isTherapistCalendar(undefined)).toBe(false);
        expect(isTherapistCalendar(PRELIM)).toBe(false);
        expect(isTherapistCalendar(14263454)).toBe(true);
    });
});
