import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface AcuityAppointment {
  id: number;
  datetime: string;
  endTime: string;
  duration: string;
  type: string;
  calendar: string;
  calendarID: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  canceled: boolean;
  canClientCancel: boolean;
  canClientReschedule: boolean;
  location: string;
  notes: string;
}

export interface AcuityAppointmentType {
  id: number;
  name: string;
  duration: number;
  price: string;
  description: string;
  category: string;
  color: string;
  calendarIDs: number[];
}

export interface AcuityCalendar {
  id: number;
  name: string;
  email: string;
  description: string;
  location: string;
}

export interface AcuityAvailableTime {
  time: string;
  slotsAvailable: number;
}

export function useAcuityAppointments(clientEmail?: string) {
  const [appointments, setAppointments] = useState<AcuityAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchAppointments = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({ action: 'get-appointments' });
      if (clientEmail) {
        params.append('email', clientEmail);
      }

      const { data, error } = await supabase.functions.invoke('acuity', {
        body: null,
        headers: {},
      });

      // Use query params approach
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?${params.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch appointments');
      }

      const appointmentsData = await response.json();
      setAppointments(appointmentsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load appointments';
      setError(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, [clientEmail]);

  return { appointments, loading, error, refetch: fetchAppointments };
}

export function useAcuityAppointmentTypes() {
  const [types, setTypes] = useState<AcuityAppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?action=get-appointment-types`,
          {
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch appointment types');
        }

        const data = await response.json();
        setTypes(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load appointment types');
      } finally {
        setLoading(false);
      }
    };

    fetchTypes();
  }, []);

  return { types, loading, error };
}

export function useAcuityCalendars() {
  const [calendars, setCalendars] = useState<AcuityCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCalendars = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?action=get-calendars`,
          {
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch calendars');
        }

        const data = await response.json();
        setCalendars(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load calendars');
      } finally {
        setLoading(false);
      }
    };

    fetchCalendars();
  }, []);

  return { calendars, loading, error };
}

export function useAcuityAvailability(
  appointmentTypeId: number | null, 
  month: string | null,
  calendarId?: number | null
) {
  const [dates, setDates] = useState<{ date: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!appointmentTypeId || !month) {
      setDates([]);
      return;
    }

    const fetchAvailability = async () => {
      setLoading(true);
      try {
        let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?action=get-availability&appointmentTypeId=${appointmentTypeId}&month=${month}`;
        if (calendarId) {
          url += `&calendarId=${calendarId}`;
        }
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch availability');
        }

        const data = await response.json();
        setDates(data);
      } catch (err) {
        console.error('Error fetching availability:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailability();
  }, [appointmentTypeId, month, calendarId]);

  return { dates, loading };
}

export function useAcuityTimes(
  appointmentTypeId: number | null, 
  date: string | null,
  calendarId?: number | null
) {
  const [times, setTimes] = useState<AcuityAvailableTime[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!appointmentTypeId || !date) {
      setTimes([]);
      return;
    }

    const fetchTimes = async () => {
      setLoading(true);
      try {
        let url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?action=get-times&appointmentTypeId=${appointmentTypeId}&date=${date}`;
        if (calendarId) {
          url += `&calendarId=${calendarId}`;
        }
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch times');
        }

        const data = await response.json();
        setTimes(data);
      } catch (err) {
        console.error('Error fetching times:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTimes();
  }, [appointmentTypeId, date, calendarId]);

  return { times, loading };
}

export async function bookAppointment(data: {
  appointmentTypeID: number;
  datetime: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
  calendarID?: number;
}) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?action=book-appointment`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to book appointment');
  }

  return response.json();
}

export async function cancelAppointment(appointmentId: number) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?action=cancel-appointment`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ appointmentId }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to cancel appointment');
  }

  return response.json();
}
