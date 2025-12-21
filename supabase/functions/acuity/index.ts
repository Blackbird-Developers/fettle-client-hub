import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACUITY_API_BASE = 'https://acuityscheduling.com/api/v1';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const acuityUserId = Deno.env.get('ACUITY_USER_ID');
  const acuityApiKey = Deno.env.get('ACUITY_API_KEY');

  if (!acuityUserId || !acuityApiKey) {
    console.error('Missing Acuity credentials');
    return new Response(
      JSON.stringify({ error: 'Acuity credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const clientEmail = url.searchParams.get('email');

    console.log(`Acuity API request: action=${action}, email=${clientEmail}`);

    switch (action) {
      case 'get-appointments': {
        // Fetch appointments for a specific client
        // Include minDate to get future appointments (Acuity defaults to past only)
        const today = new Date();
        const minDate = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().split('T')[0]; // 3 months ago
        const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, 0).toISOString().split('T')[0]; // 6 months ahead
        
        // Build base URL - fetch both active and cancelled appointments
        let baseParams = `minDate=${minDate}&maxDate=${maxDate}&max=100`;
        if (clientEmail) {
          baseParams += `&email=${encodeURIComponent(clientEmail)}`;
        }
        
        // Fetch active appointments
        const activeUrl = `${ACUITY_API_BASE}/appointments?${baseParams}`;
        console.log(`Fetching active appointments from: ${activeUrl}`);
        
        const activeResponse = await fetch(activeUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!activeResponse.ok) {
          const errorText = await activeResponse.text();
          console.error(`Acuity API error: ${activeResponse.status} - ${errorText}`);
          throw new Error(`Acuity API error: ${activeResponse.status}`);
        }

        const activeAppointments = await activeResponse.json();
        console.log(`Found ${activeAppointments.length} active appointments`);
        
        // Fetch cancelled appointments separately (Acuity requires canceled=true filter)
        const cancelledUrl = `${ACUITY_API_BASE}/appointments?${baseParams}&canceled=true`;
        console.log(`Fetching cancelled appointments from: ${cancelledUrl}`);
        
        const cancelledResponse = await fetch(cancelledUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });
        
        let cancelledAppointments: unknown[] = [];
        if (cancelledResponse.ok) {
          cancelledAppointments = await cancelledResponse.json();
          console.log(`Found ${cancelledAppointments.length} cancelled appointments`);
        } else {
          console.log('Could not fetch cancelled appointments');
        }
        
        // Combine both arrays
        const allAppointments = [...activeAppointments, ...cancelledAppointments];
        console.log(`Total appointments: ${allAppointments.length}`);
        
        return new Response(JSON.stringify(allAppointments), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-appointment-types': {
        const response = await fetch(`${ACUITY_API_BASE}/appointment-types`, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const types = await response.json();
        console.log(`Found ${types.length} appointment types`);
        
        return new Response(JSON.stringify(types), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-availability': {
        const appointmentTypeId = url.searchParams.get('appointmentTypeId');
        const month = url.searchParams.get('month'); // Format: YYYY-MM
        const calendarId = url.searchParams.get('calendarId');
        
        if (!appointmentTypeId || !month) {
          return new Response(
            JSON.stringify({ error: 'Missing appointmentTypeId or month parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let availabilityUrl = `${ACUITY_API_BASE}/availability/dates?appointmentTypeID=${appointmentTypeId}&month=${month}`;
        if (calendarId) {
          availabilityUrl += `&calendarID=${calendarId}`;
        }

        const response = await fetch(availabilityUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const availability = await response.json();
        return new Response(JSON.stringify(availability), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-times': {
        const appointmentTypeId = url.searchParams.get('appointmentTypeId');
        const date = url.searchParams.get('date'); // Format: YYYY-MM-DD
        const calendarId = url.searchParams.get('calendarId');

        if (!appointmentTypeId || !date) {
          return new Response(
            JSON.stringify({ error: 'Missing appointmentTypeId or date parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let timesUrl = `${ACUITY_API_BASE}/availability/times?appointmentTypeID=${appointmentTypeId}&date=${date}`;
        if (calendarId) {
          timesUrl += `&calendarID=${calendarId}`;
        }

        const response = await fetch(timesUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const times = await response.json();
        return new Response(JSON.stringify(times), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'book-appointment': {
        if (req.method !== 'POST') {
          return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const bookingData = await req.json();
        console.log('Booking appointment:', bookingData);

        const response = await fetch(`${ACUITY_API_BASE}/appointments`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bookingData),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Booking error: ${response.status} - ${errorText}`);
          throw new Error(`Failed to book appointment: ${response.status}`);
        }

        const appointment = await response.json();
        console.log('Appointment booked successfully:', appointment.id);
        
        return new Response(JSON.stringify(appointment), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'cancel-appointment': {
        if (req.method !== 'POST') {
          return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { appointmentId } = await req.json();
        console.log('Cancelling appointment:', appointmentId);

        const response = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}/cancel`, {
          method: 'PUT',
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to cancel appointment: ${response.status}`);
        }

        const result = await response.json();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-calendars': {
        const response = await fetch(`${ACUITY_API_BASE}/calendars`, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const calendars = await response.json();
        console.log(`Found ${calendars.length} calendars`);
        
        return new Response(JSON.stringify(calendars), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error in acuity function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
