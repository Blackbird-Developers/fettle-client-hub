import { useState, useMemo, useEffect } from 'react';
import { format, addMonths } from 'date-fns';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
    useAcuityAppointmentTypes,
    useAcuityCalendars,
    useAcuityAvailability,
    useAcuityTimes,
    useAcuityAppointments,
    AcuityCalendar,
} from '@/hooks/useAcuity';
import { useActivePackages } from '@/hooks/useUserPackages';
import { useReferrals } from '@/hooks/useReferrals';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PaymentForm } from './PaymentForm';
import {
    Clock,
    Calendar as CalendarIcon,
    CreditCard,
    User,
    Users,
    RefreshCw,
    Loader2,
    CheckCircle,
    Gift,
    Star,
    ExternalLink,
    ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPackageCategory } from '@/lib/packageCategory';
import { Checkbox } from '@/components/ui/checkbox';
import { TherapistAvatar, toSlug } from '@/components/dashboard/MyTherapist';
import { useTherapistImages, type TherapistProfile } from '@/hooks/useTherapistImages';

// Initialize Stripe with debugging
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as
    | string
    | undefined;
console.log('[Stripe Debug] Publishable key exists:', !!stripePublishableKey);
console.log(
    '[Stripe Debug] Publishable key prefix:',
    stripePublishableKey?.substring(0, 10) + '...'
);
const stripePromise = stripePublishableKey
    ? loadStripe(stripePublishableKey)
    : null;
console.log('[Stripe Debug] stripePromise created:', !!stripePromise);
export type SessionCategory = 'individual' | 'couples' | 'youth';

interface BookingModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onBookingComplete?: () => void;
    preselectedCalendarId?: number;
    preselectedCalendarName?: string;
    sessionCategory?: SessionCategory;
}

type Step =
    | 'type'
    | 'therapist'
    | 'date'
    | 'time'
    | 'details'
    | 'confirm'
    | 'payment'
    | 'success';

export function BookingModal({
    open,
    onOpenChange,
    onBookingComplete,
    preselectedCalendarId,
    preselectedCalendarName,
    sessionCategory = 'individual',
}: BookingModalProps) {
    const [step, setStep] = useState<Step>(
        preselectedCalendarId ? 'type' : 'type'
    );
    const [selectedType, setSelectedType] = useState<number | null>(null);
    const [selectedCalendar, setSelectedCalendar] = useState<number | null>(
        preselectedCalendarId || null
    );
    const [selectedDate, setSelectedDate] = useState<Date | undefined>();
    const [viewingMonth, setViewingMonth] = useState<Date>(new Date()); // Track which month the calendar is showing
    const [selectedTime, setSelectedTime] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [ignorePreselectedTherapist, setIgnorePreselectedTherapist] =
        useState(false);
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        notes: '',
        partnerName: '',
    });

    // Intake form checkboxes (required by Acuity)
    const [intakeForm, setIntakeForm] = useState({
        over18: false,
        contactConsent: false,
        termsAccepted: false,
        youthConsentAcknowledged: false, // Required for Youth Therapy sessions
    });

    // Payment state
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
    const [paymentAmount, setPaymentAmount] = useState<number>(0);
    const [paymentLivemode, setPaymentLivemode] = useState<boolean | null>(
        null
    );
    const [bookingResult, setBookingResult] = useState<{
        appointment: any;
        receiptUrl?: string;
    } | null>(null);
    const [couponCode, setCouponCode] = useState('');
    const [usePackageCredits, setUsePackageCredits] = useState(false);
    const [applyReferralCredit, setApplyReferralCredit] = useState(false);
    const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
        null
    );
    const [hasUserMadePaymentChoice, setHasUserMadePaymentChoice] = useState(false);

    const { toast } = useToast();
    const { profile, user } = useAuth();
    const { data: referralData } = useReferrals();
    const referralBalanceCents = referralData?.balance_cents ?? 0;
    const queryClient = useQueryClient();

    // Fetch user's active packages
    const { packages: activePackages, isLoading: packagesLoading } =
        useActivePackages();

    // Only credits whose bundle category matches the session being booked may
    // be redeemed — a youth/couples bundle can't pay for an individual session
    // (and vice versa). Acuity enforces this on newer certificates via
    // appointmentTypeIDs, and book-with-package enforces it server-side, but we
    // also scope the UI so users are never offered credits they can't use.
    const categoryPackages = useMemo(
        () =>
            activePackages.filter(
                (pkg) => getPackageCategory(pkg.package_id) === sessionCategory
            ),
        [activePackages, sessionCategory]
    );
    const categoryRemainingSessions = useMemo(
        () =>
            categoryPackages.reduce(
                (sum, pkg) => sum + pkg.remaining_sessions,
                0
            ),
        [categoryPackages]
    );

    // Auto-select package credits when user enters confirm step and has packages available
    // Only auto-select if user hasn't explicitly made a choice yet
    useEffect(() => {
        if (step === 'confirm' && categoryRemainingSessions > 0 && !packagesLoading && !hasUserMadePaymentChoice) {
            // Auto-select package credits as the default choice
            setUsePackageCredits(true);
            const firstPackage = categoryPackages[0];
            if (firstPackage) {
                setSelectedPackageId(firstPackage.id);
            }
        }
    }, [step, categoryRemainingSessions, packagesLoading, categoryPackages, hasUserMadePaymentChoice]);

    const { types, loading: typesLoading } = useAcuityAppointmentTypes();
    const { calendars, loading: calendarsLoading } = useAcuityCalendars();
    const { appointments } = useAcuityAppointments(profile?.email);
    const { images: therapistImages, profiles: therapistProfiles } = useTherapistImages();

    // Use viewingMonth for availability query - this updates when user navigates calendar
    const { dates: availableDates, loading: datesLoading } =
        useAcuityAvailability(
            selectedType,
            format(viewingMonth, 'yyyy-MM'),
            selectedCalendar
        );

    const { times: availableTimes, loading: timesLoading } = useAcuityTimes(
        selectedType,
        selectedDate ? format(selectedDate, 'yyyy-MM-dd') : null,
        selectedCalendar
    );

    // Filter appointment types based on session category and whether we're rebooking
    const filteredAppointmentTypes = useMemo(() => {
        if (preselectedCalendarName && !ignorePreselectedTherapist) {
            // When rebooking, show only session types for the specific therapist
            // Trim the name as some calendars (like Ken Gallagher) have trailing spaces from Acuity API
            const trimmedCalendarName = preselectedCalendarName.trim();
            const therapistFirstName = trimmedCalendarName.split(' ')[0];
            return types.filter((type) => {
                const nameLower = type.name.toLowerCase();
                const therapistNameLower = therapistFirstName.toLowerCase();
                const fullNameLower = trimmedCalendarName.toLowerCase();

                switch (sessionCategory) {
                    case 'couples':
                        return (
                            nameLower.includes(
                                `couple's therapy session with ${therapistNameLower}`
                            ) ||
                            nameLower.includes(
                                `couple's therapy session with ${fullNameLower}`
                            )
                        );
                    case 'youth':
                        return (
                            nameLower.includes(
                                `youth therapy - individual session with ${therapistNameLower}`
                            ) ||
                            nameLower.includes(
                                `youth therapy - individual session with ${fullNameLower}`
                            )
                        );
                    default: // individual
                        return (
                            (nameLower.includes(
                                `individual session with ${therapistNameLower}`
                            ) ||
                                nameLower.includes(
                                    `individual session with ${fullNameLower}`
                                )) &&
                            !nameLower.includes('youth therapy')
                        );
                }
            });
        }

        // Filter by session category
        switch (sessionCategory) {
            case 'couples':
                return types.filter((type) =>
                    type.name.startsWith("Couple's Therapy Session")
                );
            case 'youth':
                return types.filter((type) =>
                    type.name.startsWith('Youth Therapy - Individual Session')
                );
            default: // individual
                return types.filter((type) =>
                    type.name.startsWith('Individual Therapy Session')
                );
        }
    }, [
        types,
        preselectedCalendarName,
        ignorePreselectedTherapist,
        sessionCategory,
    ]);

    // Get a human-readable label for the session category
    const getSessionCategoryLabel = () => {
        switch (sessionCategory) {
            case 'couples':
                return "Couple's Therapy";
            case 'youth':
                return 'Youth Therapy';
            default:
                return 'Individual Therapy';
        }
    };

    // Helper to format the display name for clearer customer understanding
    const formatSessionDisplayName = (
        name: string,
        isTherapistSpecific: boolean = false
    ) => {
        // For couples and youth sessions, show just the therapist name
        if (sessionCategory === 'couples' || sessionCategory === 'youth') {
            const therapistName = extractTherapistFromTypeName(name);
            if (therapistName) {
                return therapistName;
            }
        }

        if (isTherapistSpecific) {
            // For therapist-specific sessions, extract duration or session type info
            const durationMatch = name.match(/\((\d+)\s*min\)/i);
            if (durationMatch) {
                return `${durationMatch[1]} Minute Session`;
            }
            // Remove prefixes based on session category
            let cleaned = name;
            if (sessionCategory === 'couples') {
                cleaned = name
                    .replace(/Couple's Therapy Session with [^(]+/i, '')
                    .trim();
            } else if (sessionCategory === 'youth') {
                cleaned = name
                    .replace(
                        /Youth Therapy - Individual Session with [^(]+/i,
                        ''
                    )
                    .trim();
            } else {
                cleaned = name
                    .replace(/Individual Session with [^(]+/i, '')
                    .trim();
            }
            return cleaned || 'Therapy Session';
        }

        // Extract the focus area from parentheses
        const match = name.match(/\(([^)]+)\)/);
        if (match) {
            return match[1];
        }

        // Remove common prefixes based on category
        if (sessionCategory === 'couples') {
            return (
                name.replace("Couple's Therapy Session", '').trim() ||
                'General Session'
            );
        } else if (sessionCategory === 'youth') {
            return (
                name.replace('Youth Therapy - Individual Session', '').trim() ||
                'General Session'
            );
        }
        return (
            name.replace('Individual Therapy Session', '').trim() ||
            'General Session'
        );
    };

    // Extract therapist name from couples/youth appointment type names
    const extractTherapistFromTypeName = (typeName: string): string | null => {
        // Match patterns like "Couple's Therapy Session with John Smith" or "Youth Therapy - Individual Session with Jane Doe"
        const couplesMatch = typeName.match(
            /Couple's Therapy Session with (.+?)(?:\s*\(|$)/i
        );
        if (couplesMatch) return couplesMatch[1].trim();

        const youthMatch = typeName.match(
            /Youth Therapy - Individual Session with (.+?)(?:\s*\(|$)/i
        );
        if (youthMatch) return youthMatch[1].trim();

        return null;
    };

    // Get the therapist name - either from calendar data or extracted from type name for couples/youth
    // Trim the name as some calendars (like Ken Gallagher) have trailing spaces from Acuity API
    const getTherapistDisplayName = (): string | null => {
        if (selectedCalendarData?.name) {
            return selectedCalendarData.name.trim();
        }
        if (
            selectedTypeData &&
            (sessionCategory === 'couples' || sessionCategory === 'youth')
        ) {
            return extractTherapistFromTypeName(selectedTypeData.name);
        }
        return null;
    };

    const selectedTypeData = types.find((t) => t.id === selectedType);
    const selectedCalendarData = calendars.find(
        (c) => c.id === selectedCalendar
    );

    // Get therapists that offer the selected service
    const availableTherapists = useMemo(() => {
        if (!selectedTypeData || !calendars.length) return [];

        const calendarIds = selectedTypeData.calendarIDs || [];
        return calendars.filter((calendar) =>
            calendarIds.includes(calendar.id)
        );
    }, [selectedTypeData, calendars]);

    // Get previous therapist from past appointments
    const previousTherapist = useMemo(() => {
        if (!appointments.length) return null;

        const sortedAppointments = [...appointments]
            .filter((a) => !a.canceled)
            .sort(
                (a, b) =>
                    new Date(b.datetime).getTime() -
                    new Date(a.datetime).getTime()
            );

        if (sortedAppointments.length === 0) return null;

        const lastAppointment = sortedAppointments[0];
        return (
            calendars.find((c) => c.id === lastAppointment.calendarID) || null
        );
    }, [appointments, calendars]);

    const availableDateStrings = availableDates.map((d) => d.date);

    const isDateAvailable = (date: Date) => {
        const dateString = format(date, 'yyyy-MM-dd');
        return availableDateStrings.includes(dateString);
    };

    const handleBookWithPackage = async () => {
        if (
            !selectedType ||
            !selectedTime ||
            !selectedTypeData ||
            !selectedPackageId
        ) {
            return;
        }

        // Guard: partner name is required for couples sessions
        if (sessionCategory === 'couples' && !formData.partnerName.trim()) {
            toast({
                title: 'Partner name required',
                description: "Please go back to the details step and enter your partner's name.",
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        try {
            // Build intake form fields based on session category
            const intakeFormFields = sessionCategory === 'youth'
                ? [
                    { id: 13686405, value: 'yes' }, // Youth Therapy consent acknowledgment
                    { id: 9292394, value: 'yes' },  // Contact consent
                    { id: 9292405, value: 'yes' },  // Terms accepted
                  ]
                : sessionCategory === 'couples'
                ? [
                    { id: 10466116, value: 'yes' },                    // Over 18 confirmation
                    { id: 9292394, value: 'yes' },                     // Contact consent
                    { id: 9292405, value: 'yes' },                     // Terms accepted
                    { id: 10104284, value: formData.partnerName },     // Partner's name & pronouns
                  ]
                : [
                    { id: 10466116, value: 'yes' }, // Over 18 confirmation
                    { id: 9292394, value: 'yes' },  // Contact consent
                    { id: 9292405, value: 'yes' },  // Terms accepted
                  ];

            const { data, error } = await supabase.functions.invoke(
                'book-with-package',
                {
                    body: {
                        packageId: selectedPackageId,
                        appointmentTypeID: selectedType,
                        datetime: selectedTime,
                        calendarID: selectedCalendar,
                        firstName: formData.firstName,
                        lastName: formData.lastName,
                        email: formData.email,
                        phone: formData.phone || undefined,
                        notes: formData.notes || undefined,
                        intakeFormFields,
                        // User's timezone for email formatting
                        timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
                }
            );

            if (error) throw error;
            if (data.error) throw new Error(data.error);

            // Invalidate packages query to refresh the counter
            queryClient.invalidateQueries({ queryKey: ['user-packages'] });

            setBookingResult({ appointment: data.appointment });
            setStep('success');

            toast({
                title: 'Session Booked!',
                description: `You have ${data.remainingSessions} session${
                    data.remainingSessions === 1 ? '' : 's'
                } remaining in your package.`,
            });
        } catch (error) {
            console.error('Package booking error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to book session. Please contact hello@fettle.ie for support.';
            const isExpired = errorMessage.toLowerCase().includes('expired');
            const isNoSessions = errorMessage.toLowerCase().includes('no remaining');
            const isNotFound = errorMessage.toLowerCase().includes('couldn\'t find');
            const isAuth = errorMessage.toLowerCase().includes('sign in') || errorMessage.toLowerCase().includes('session has expired');

            let title = 'Booking Failed';
            if (isExpired) title = 'Package Expired';
            else if (isNoSessions) title = 'No Sessions Remaining';
            else if (isNotFound) title = 'Package Not Found';
            else if (isAuth) title = 'Authentication Required';

            toast({
                title,
                description: errorMessage,
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleProceedToPayment = async () => {
        // If using package credits, book with package instead
        if (usePackageCredits && selectedPackageId) {
            return handleBookWithPackage();
        }

        console.log('[Stripe Debug] handleProceedToPayment called');
        console.log('[Stripe Debug] selectedType:', selectedType);
        console.log('[Stripe Debug] selectedTime:', selectedTime);
        console.log('[Stripe Debug] selectedTypeData:', selectedTypeData);

        if (!selectedType || !selectedTime || !selectedTypeData) {
            console.log(
                '[Stripe Debug] Missing required data, returning early'
            );
            return;
        }

        // Verify we have all required data (same as filter.html)
        if (!formData.firstName || !formData.lastName || !formData.email) {
            toast({
                title: 'Incomplete Information',
                description: 'Please fill in all required fields',
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        try {
            // Build intake form fields based on session category
            const intakeFormFields = sessionCategory === 'youth'
                ? [
                    { id: 13686405, value: 'yes' }, // Youth Therapy consent acknowledgment
                    { id: 9292394, value: 'yes' },  // Contact consent
                    { id: 9292405, value: 'yes' },  // Terms accepted
                  ]
                : sessionCategory === 'couples'
                ? [
                    { id: 10466116, value: 'yes' },                    // Over 18 confirmation
                    { id: 9292394, value: 'yes' },                     // Contact consent
                    { id: 9292405, value: 'yes' },                     // Terms accepted
                    { id: 10104284, value: formData.partnerName },     // Partner's name & pronouns
                  ]
                : [
                    { id: 10466116, value: 'yes' }, // Over 18 confirmation
                    { id: 9292394, value: 'yes' },  // Contact consent
                    { id: 9292405, value: 'yes' },  // Terms accepted
                  ];

            const requestBody = {
                appointmentTypeID: selectedType,
                appointmentTypeName: selectedTypeData.name,
                appointmentTypePrice: selectedTypeData.price,
                datetime: selectedTime,
                calendarID: selectedCalendar,
                calendarName: selectedCalendarData?.name?.trim(),
                firstName: formData.firstName,
                lastName: formData.lastName,
                email: formData.email,
                phone: formData.phone || undefined,
                notes: formData.notes || undefined,
                // Acuity intake form fields (JSON stringified for Stripe metadata)
                intakeFormFields: JSON.stringify(intakeFormFields),
                // User's timezone for email formatting
                timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                // Optional loyalty coupon (validated + applied server-side)
                couponCode: couponCode.trim() || undefined,
                // Apply referral credit (server reduces the charge / may fully cover)
                useReferralCredit: applyReferralCredit,
            };

            console.log(
                '[Stripe Debug] Calling create-payment-intent with:',
                requestBody
            );

            // Create PaymentIntent (embedded payment form - same as filter.html)
            const { data, error } = await supabase.functions.invoke(
                'create-payment-intent',
                {
                    body: requestBody,
                }
            );

            console.log('[Stripe Debug] Response data:', data);
            console.log('[Stripe Debug] Response error:', error);

            if (error) throw error;
            if (data.error) throw new Error(data.error);

            // Referral credit covers the whole price → no Stripe. Book via the
            // dedicated no-charge path and jump straight to success.
            if (data.fullyCovered) {
                const { data: bookData, error: bookError } = await supabase.functions.invoke(
                    'book-with-credit',
                    {
                        body: {
                            appointmentTypeID: selectedType,
                            appointmentTypeName: selectedTypeData.name,
                            appointmentTypePrice: selectedTypeData.price,
                            datetime: selectedTime,
                            calendarID: selectedCalendar,
                            calendarName: selectedCalendarData?.name?.trim(),
                            firstName: formData.firstName,
                            lastName: formData.lastName,
                            email: formData.email,
                            phone: formData.phone || undefined,
                            notes: formData.notes || undefined,
                            intakeFormFields: JSON.stringify(intakeFormFields),
                            timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                        },
                    }
                );
                if (bookError) throw bookError;
                if (bookData.error) throw new Error(bookData.error);

                queryClient.invalidateQueries({ queryKey: ['referral-overview'] });
                setBookingResult({ appointment: bookData.appointment });
                setStep('success');
                toast({
                    title: 'Session Booked!',
                    description: `Fully covered by your €${(referralBalanceCents / 100).toFixed(0)} referral credit — €0 to pay.`,
                });
                return;
            }

            // Surface the loyalty-coupon outcome before charging.
            if (couponCode.trim()) {
                if (data.discountApplied) {
                    toast({
                        title: `Coupon applied — ${data.discountPercent}% off`,
                        description: `You're paying €${((data.amount || 0) / 100).toFixed(2)} instead of €${((data.originalAmount || 0) / 100).toFixed(2)}.`,
                    });
                } else if (data.couponRejected) {
                    const reasons: Record<string, string> = {
                        unknown_code: "That coupon code isn't recognised.",
                        not_signed_in: "We couldn't verify your account to apply this coupon.",
                        server_unavailable: "We couldn't verify your coupon right now — please try again.",
                        validation_error: "We couldn't verify your coupon right now — please try again.",
                        not_earned: "This reward hasn't been unlocked on your account yet.",
                        coupon_invalid: "This coupon is no longer valid.",
                        coupon_not_found: "This coupon is no longer valid.",
                        coupon_no_discount: "This coupon is no longer valid.",
                        below_minimum: "This coupon can't be applied to this session.",
                    };
                    toast({
                        title: 'Coupon not applied',
                        description: `${reasons[data.couponRejected] || 'This coupon could not be applied.'} Proceeding at full price.`,
                        variant: 'destructive',
                    });
                }
            }

            // Save clientSecret and other data (same as filter.html)
            if (data.clientSecret && data.paymentIntentId) {
                setClientSecret(data.clientSecret);
                setPaymentIntentId(data.paymentIntentId);
                setPaymentAmount(
                    data.amount ||
                        Math.round(parseFloat(selectedTypeData.price) * 100)
                );
                setPaymentLivemode(
                    data.livemode !== undefined ? data.livemode : null
                );

                console.log('[Stripe Debug] Payment data saved to state');
                console.log(
                    '[Stripe Debug] clientSecret:',
                    data.clientSecret ? 'Present' : 'Missing'
                );
                console.log(
                    '[Stripe Debug] paymentIntentId:',
                    data.paymentIntentId || 'Missing'
                );
                console.log('[Stripe Debug] amount:', data.amount);
                console.log('[Stripe Debug] livemode:', data.livemode);

                // Go to payment step (same as filter.html step 6)
                setStep('payment');
            } else {
                throw new Error('No clientSecret or paymentIntentId returned');
            }
        } catch (error) {
            console.error('[Stripe Debug] Error:', error);
            const errorMessage = error instanceof Error
                ? error.message
                : 'Failed to initialize payment. Please try again or contact hello@fettle.ie for support.';
            toast({
                title: 'Payment Setup Failed',
                description: errorMessage,
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handlePaymentSuccess = (result: {
        appointment: any;
        receiptUrl?: string;
    }) => {
        // Referral credit may have been redeemed during this payment — refresh it.
        queryClient.invalidateQueries({ queryKey: ['referral-overview'] });
        setBookingResult(result);
        setStep('success');
    };

    const handleClose = () => {
        setStep('type');
        setSelectedType(null);
        setSelectedCalendar(preselectedCalendarId || null);
        setSelectedDate(undefined);
        setViewingMonth(new Date()); // Reset calendar view to current month
        setSelectedTime(null);
        setFormData({
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            notes: '',
        });
        setIntakeForm({
            over18: false,
            contactConsent: false,
            termsAccepted: false,
            youthConsentAcknowledged: false,
        });
        setClientSecret(null);
        setPaymentIntentId(null);
        setPaymentAmount(0);
        setPaymentLivemode(null);
        setBookingResult(null);
        setCouponCode('');
        setUsePackageCredits(false);
        setApplyReferralCredit(false);
        setSelectedPackageId(null);
        setHasUserMadePaymentChoice(false);
        setIgnorePreselectedTherapist(false);
        onOpenChange(false);

        if (bookingResult) {
            onBookingComplete?.();
        }
    };

    const handleBookWithAnotherTherapist = () => {
        setIgnorePreselectedTherapist(true);
        setSelectedCalendar(null);
    };

    // When a preselected therapist is provided and a type is selected, skip to date
    // For couples/youth sessions, the therapist is embedded in the type name, so extract calendar and skip to date
    const handleTypeSelection = (typeId: number) => {
        setSelectedType(typeId);

        // For couples and youth sessions, therapist is part of the type name - extract calendar ID and skip to date
        if (sessionCategory === 'couples' || sessionCategory === 'youth') {
            const selectedTypeInfo = types.find((t) => t.id === typeId);
            // Get the first available calendar for this type (therapist is already specified in the type)
            if (selectedTypeInfo?.calendarIDs?.length) {
                setSelectedCalendar(selectedTypeInfo.calendarIDs[0]);
                setStep('date');
                return;
            }
        }

        setSelectedCalendar(preselectedCalendarId || null);
        if (preselectedCalendarId) {
            setStep('date');
        } else {
            setStep('therapist');
        }
    };

    const handleSelectTherapist = (calendarId: number) => {
        setSelectedCalendar(calendarId);
        setStep('date');
    };

    /** Format a tag string for display: "cbt" → "CBT", "anxiety" → "Anxiety" */
    const formatTag = (tag: string) => {
        const upper = tag.toUpperCase();
        if (['CBT', 'DBT', 'EMDR', 'ACT', 'LGBTQ+', 'ADHD', 'OCD', 'PTSD'].includes(upper)) return upper;
        return tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
    };

    /** Get accreditation display text */
    const getAccreditationText = (acc: string | null): string | null => {
        if (!acc) return null;
        const lower = acc.toLowerCase();
        if (lower.includes('iacpfull') || lower.includes('iacp full') || lower === 'iacpful') return 'IACP Accredited';
        if (lower.includes('iahippre') || lower.includes('iahip pre')) return 'IAHIP Pre-Accredited';
        if (lower.includes('iahipfull') || lower.includes('iahip full')) return 'IAHIP Accredited';
        if (lower.includes('icp') || lower === 'icp') return 'ICP Registered';
        if (lower.includes('iacp')) return 'IACP Member';
        if (lower.includes('iahip')) return 'IAHIP Member';
        if (acc.trim()) return acc.trim();
        return null;
    };

    const renderTherapistCard = (
        therapist: AcuityCalendar,
        isPrevious: boolean = false
    ) => {
        const tProfile = therapistProfiles.get(therapist.id);
        const imageUrl = therapistImages.get(therapist.id);
        const accreditationText = getAccreditationText(tProfile?.accreditation || null);
        const tags = (tProfile?.tags || []).slice(0, 3);
        const profileUrl = `https://fettle.ie/our-therapists/${toSlug(therapist.name)}`;

        return (
            <div
                key={therapist.id}
                className={cn(
                    'w-full p-4 rounded-xl border-2 text-left transition-all',
                    selectedCalendar === therapist.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                )}>
                <div className="flex items-start gap-3">
                    <TherapistAvatar
                        name={therapist.name}
                        calendarId={therapist.id}
                        imageUrl={imageUrl}
                        size="md"
                    />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            {isPrevious && (
                                <Star className="h-4 w-4 text-amber-500 fill-amber-500 shrink-0" />
                            )}
                            <h4 className="font-semibold text-foreground truncate">
                                {therapist.name}
                            </h4>
                            {isPrevious && (
                                <Badge variant="secondary" className="text-xs shrink-0">
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Previous
                                </Badge>
                            )}
                        </div>
                        {accreditationText && (
                            <p className="text-xs text-primary font-medium mt-0.5">
                                {accreditationText}
                            </p>
                        )}
                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                                {tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                        {formatTag(tag)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 mt-3">
                    <Button
                        size="sm"
                        className="flex-1 gap-1.5"
                        onClick={() => handleSelectTherapist(therapist.id)}
                    >
                        Book Now
                        <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5"
                        asChild
                    >
                        <a
                            href={profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            View Profile
                        </a>
                    </Button>
                </div>
            </div>
        );
    };

    const renderStep = () => {
        switch (step) {
            case 'type':
                // Show enhanced loading state when checking therapist availability
                if (
                    typesLoading &&
                    preselectedCalendarName &&
                    !ignorePreselectedTherapist
                ) {
                    return (
                        <div className="space-y-4 animate-fade-in">
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/10 animate-scale-in">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                    <User className="h-5 w-5 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <p className="font-medium text-foreground">
                                        {preselectedCalendarName}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Checking availability...
                                    </p>
                                </div>
                                <Loader2 className="h-5 w-5 text-primary animate-spin" />
                            </div>
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton
                                        key={i}
                                        className="h-20 w-full rounded-xl animate-fade-in"
                                        style={{
                                            animationDelay: `${i * 100}ms`,
                                            animationFillMode: 'backwards',
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                }

                return (
                    <div className="space-y-4">
                        <p className="text-muted-foreground">
                            {preselectedCalendarName &&
                            !ignorePreselectedTherapist
                                ? `Select a session type to book with ${preselectedCalendarName}`
                                : sessionCategory === 'couples' ||
                                  sessionCategory === 'youth'
                                ? 'Select your therapist'
                                : "Select the type of session you'd like to book"}
                        </p>
                        {typesLoading ? (
                            <div className="space-y-3">
                                {[1, 2, 3].map((i) => (
                                    <Skeleton
                                        key={i}
                                        className="h-20 w-full rounded-xl"
                                    />
                                ))}
                            </div>
                        ) : filteredAppointmentTypes.length === 0 &&
                          preselectedCalendarName &&
                          !ignorePreselectedTherapist ? (
                            <div className="text-center py-8 space-y-4">
                                <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                                    <CalendarIcon className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <div>
                                    <p className="text-muted-foreground">
                                        No available session types found for{' '}
                                        {preselectedCalendarName}.
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        This therapist may not have open
                                        availability right now.
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    onClick={handleBookWithAnotherTherapist}
                                    className="mt-2">
                                    Book with another therapist
                                </Button>
                            </div>
                        ) : (
                            <ScrollArea className="h-[300px] pr-4">
                                <div className="space-y-3">
                                    {filteredAppointmentTypes.map((type) => (
                                        <button
                                            key={type.id}
                                            onClick={() =>
                                                handleTypeSelection(type.id)
                                            }
                                            className={cn(
                                                'w-full p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50 hover:bg-accent/50',
                                                selectedType === type.id
                                                    ? 'border-primary bg-primary/5'
                                                    : 'border-border'
                                            )}>
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h4 className="font-semibold text-foreground">
                                                        {formatSessionDisplayName(
                                                            type.name,
                                                            !!preselectedCalendarName
                                                        )}
                                                    </h4>
                                                </div>
                                                <div className="text-right shrink-0 ml-4">
                                                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                        <Clock className="h-3.5 w-3.5" />
                                                        {type.duration} min
                                                    </div>
                                                    {type.price &&
                                                        type.price !== '0' && (
                                                            <p className="text-sm font-medium text-primary mt-1">
                                                                €{type.price}
                                                            </p>
                                                        )}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>
                        )}
                    </div>
                );

            case 'therapist':
                return (
                    <div className="space-y-4">
                        <p className="text-muted-foreground">
                            Choose your therapist for {selectedTypeData?.name}
                        </p>
                        {calendarsLoading ? (
                            <div className="space-y-3">
                                {[1, 2].map((i) => (
                                    <Skeleton key={i} className="h-20 w-full" />
                                ))}
                            </div>
                        ) : availableTherapists.length > 0 ? (
                            <ScrollArea className="h-[300px] pr-4">
                                <div className="space-y-3">
                                    {previousTherapist &&
                                        availableTherapists.some(
                                            (t) => t.id === previousTherapist.id
                                        ) && (
                                            <>
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Users className="h-4 w-4" />
                                                    <span>
                                                        Rebook with your
                                                        previous therapist
                                                    </span>
                                                </div>
                                                {renderTherapistCard(
                                                    previousTherapist,
                                                    true
                                                )}
                                                <div className="relative py-2">
                                                    <div className="absolute inset-0 flex items-center">
                                                        <span className="w-full border-t" />
                                                    </div>
                                                    <div className="relative flex justify-center text-xs uppercase">
                                                        <span className="bg-background px-2 text-muted-foreground">
                                                            Or choose another
                                                        </span>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                    {availableTherapists
                                        .filter(
                                            (t) =>
                                                t.id !== previousTherapist?.id
                                        )
                                        .map((therapist) =>
                                            renderTherapistCard(therapist)
                                        )}
                                </div>
                            </ScrollArea>
                        ) : (
                            <p className="text-center text-muted-foreground py-8">
                                No therapists available for this session type
                            </p>
                        )}
                        <Button
                            variant="ghost"
                            onClick={() => setStep('type')}
                            className="w-full">
                            Back to session types
                        </Button>
                    </div>
                );

            case 'date':
                const therapistName = getTherapistDisplayName();
                return (
                    <div className="space-y-4">
                        <p className="text-muted-foreground">
                            Choose a date
                            {therapistName ? ` with ${therapistName}` : ''}
                        </p>
                        <div className="flex justify-center">
                            {datesLoading ? (
                                <div className="flex flex-col items-center justify-center py-12 gap-3">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <p className="text-sm text-muted-foreground">
                                        Loading available dates...
                                    </p>
                                </div>
                            ) : (
                                <Calendar
                                    mode="single"
                                    selected={selectedDate}
                                    month={viewingMonth}
                                    onMonthChange={setViewingMonth}
                                    onSelect={(date) => {
                                        setSelectedDate(date);
                                        if (date) setStep('time');
                                    }}
                                    disabled={(date) => {
                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        return (
                                            date < today ||
                                            !isDateAvailable(date)
                                        );
                                    }}
                                    fromDate={new Date()}
                                    toDate={addMonths(new Date(), 3)}
                                    className="rounded-xl border pointer-events-auto"
                                />
                            )}
                        </div>
                        <Button
                            variant="ghost"
                            onClick={() =>
                                setStep(
                                    sessionCategory === 'couples' ||
                                        sessionCategory === 'youth'
                                        ? 'type'
                                        : 'therapist'
                                )
                            }
                            className="w-full">
                            {sessionCategory === 'couples' ||
                            sessionCategory === 'youth'
                                ? 'Back to session types'
                                : 'Back to therapist selection'}
                        </Button>
                    </div>
                );

            case 'time':
                return (
                    <div className="space-y-4">
                        <p className="text-muted-foreground">
                            Available times for{' '}
                            {selectedDate &&
                                format(selectedDate, 'EEEE, MMMM d')}
                        </p>
                        {timesLoading ? (
                            <div className="grid grid-cols-3 gap-2">
                                {[1, 2, 3, 4, 5, 6].map((i) => (
                                    <Skeleton key={i} className="h-10 w-full" />
                                ))}
                            </div>
                        ) : availableTimes.length > 0 ? (
                            <ScrollArea className="h-[250px]">
                                <div className="grid grid-cols-3 gap-2 pr-4">
                                    {availableTimes.map((slot) => (
                                        <Button
                                            key={slot.time}
                                            variant={
                                                selectedTime === slot.time
                                                    ? 'default'
                                                    : 'outline'
                                            }
                                            onClick={() => {
                                                setSelectedTime(slot.time);
                                                setStep('details');
                                            }}
                                            className="h-10">
                                            {format(
                                                new Date(slot.time),
                                                'h:mm a'
                                            )}
                                        </Button>
                                    ))}
                                </div>
                            </ScrollArea>
                        ) : (
                            <p className="text-center text-muted-foreground py-8">
                                No available times for this date
                            </p>
                        )}
                        <Button
                            variant="ghost"
                            onClick={() => setStep('date')}
                            className="w-full">
                            Back to calendar
                        </Button>
                    </div>
                );

            case 'details':
                // For Youth Therapy, require youth consent instead of over18
                const allIntakeFieldsChecked = sessionCategory === 'youth'
                    ? intakeForm.youthConsentAcknowledged && intakeForm.contactConsent && intakeForm.termsAccepted
                    : intakeForm.over18 && intakeForm.contactConsent && intakeForm.termsAccepted;
                return (
                    <div className="space-y-4">
                        <p className="text-muted-foreground">
                            Enter your details to complete the booking
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="firstName">First Name</Label>
                                <Input
                                    id="firstName"
                                    value={formData.firstName}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            firstName: e.target.value,
                                        }))
                                    }
                                    placeholder="John"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastName">Last Name</Label>
                                <Input
                                    id="lastName"
                                    value={formData.lastName}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            lastName: e.target.value,
                                        }))
                                    }
                                    placeholder="Doe"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        email: e.target.value,
                                    }))
                                }
                                placeholder="john@example.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">Phone (optional)</Label>
                            <Input
                                id="phone"
                                type="tel"
                                value={formData.phone}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        phone: e.target.value,
                                    }))
                                }
                                placeholder="+353 87 123 4567"
                            />
                        </div>
                        {sessionCategory === 'couples' && (
                            <div className="space-y-2">
                                <Label htmlFor="partnerName">Partner's Name & Pronouns</Label>
                                <Input
                                    id="partnerName"
                                    value={formData.partnerName}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            partnerName: e.target.value,
                                        }))
                                    }
                                    placeholder="e.g. Jane Doe (she/her)"
                                />
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="notes">Notes (optional)</Label>
                            <Textarea
                                id="notes"
                                value={formData.notes}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        notes: e.target.value,
                                    }))
                                }
                                placeholder="Any information you'd like your therapist to know..."
                                rows={3}
                            />
                        </div>

                        {/* Required Intake Form Fields */}
                        <div className="space-y-3 pt-2 border-t">
                            <p className="text-sm font-medium text-foreground">Required Confirmations</p>

                            {/* Show Youth Therapy consent for youth sessions, Over 18 for others */}
                            {sessionCategory === 'youth' ? (
                                <div className="flex items-start space-x-3">
                                    <Checkbox
                                        id="youthConsentAcknowledged"
                                        checked={intakeForm.youthConsentAcknowledged}
                                        onCheckedChange={(checked) =>
                                            setIntakeForm((prev) => ({
                                                ...prev,
                                                youthConsentAcknowledged: checked === true,
                                            }))
                                        }
                                    />
                                    <Label
                                        htmlFor="youthConsentAcknowledged"
                                        className="text-sm leading-tight cursor-pointer">
                                        I acknowledge and agree that I have completed the mandatory consent form for Fettle Youth Therapy.
                                    </Label>
                                </div>
                            ) : (
                                <div className="flex items-start space-x-3">
                                    <Checkbox
                                        id="over18"
                                        checked={intakeForm.over18}
                                        onCheckedChange={(checked) =>
                                            setIntakeForm((prev) => ({
                                                ...prev,
                                                over18: checked === true,
                                            }))
                                        }
                                    />
                                    <Label
                                        htmlFor="over18"
                                        className="text-sm leading-tight cursor-pointer">
                                        This service is for over 18's only. Please tick the box to confirm you are over 18.
                                    </Label>
                                </div>
                            )}

                            <div className="flex items-start space-x-3">
                                <Checkbox
                                    id="contactConsent"
                                    checked={intakeForm.contactConsent}
                                    onCheckedChange={(checked) =>
                                        setIntakeForm((prev) => ({
                                            ...prev,
                                            contactConsent: checked === true,
                                        }))
                                    }
                                />
                                <Label
                                    htmlFor="contactConsent"
                                    className="text-sm leading-tight cursor-pointer">
                                    I agree to be contacted by email and text message by Fettle. Texts are an essential method to send out your appointment log in details, and other relevant information to do with booking.
                                </Label>
                            </div>

                            <div className="flex items-start space-x-3">
                                <Checkbox
                                    id="termsAccepted"
                                    checked={intakeForm.termsAccepted}
                                    onCheckedChange={(checked) =>
                                        setIntakeForm((prev) => ({
                                            ...prev,
                                            termsAccepted: checked === true,
                                        }))
                                    }
                                />
                                <Label
                                    htmlFor="termsAccepted"
                                    className="text-sm leading-tight cursor-pointer">
                                    Do you accept our terms of use?{' '}
                                    <a
                                        href="https://www.fettle.ie/terms-of-use"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline">
                                        View Terms & Conditions
                                    </a>
                                </Label>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => setStep('time')}
                                className="flex-1">
                                Back
                            </Button>
                            <Button
                                onClick={() => setStep('confirm')}
                                className="flex-1"
                                disabled={
                                    !formData.firstName ||
                                    !formData.lastName ||
                                    !formData.email ||
                                    !allIntakeFieldsChecked ||
                                    (sessionCategory === 'couples' && !formData.partnerName)
                                }>
                                Review Booking
                            </Button>
                        </div>
                    </div>
                );

            case 'confirm':
                return (
                    <div className="space-y-6">
                        <div className="bg-accent/50 rounded-xl p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <CalendarIcon className="h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">
                                        {selectedTypeData?.name}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {selectedTypeData?.duration} minutes
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Users className="h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">
                                        {getTherapistDisplayName() ||
                                            'Your therapist'}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Your therapist
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Clock className="h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">
                                        {selectedTime &&
                                            format(
                                                new Date(selectedTime),
                                                'EEEE, MMMM d, yyyy'
                                            )}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {selectedTime &&
                                            format(
                                                new Date(selectedTime),
                                                'h:mm a'
                                            )}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <User className="h-5 w-5 text-primary" />
                                <div>
                                    <p className="font-medium">
                                        {formData.firstName} {formData.lastName}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {formData.email}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Loading state for packages */}
                        {packagesLoading && (
                            <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-border bg-accent/30">
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">
                                    Checking for available session credits...
                                </p>
                            </div>
                        )}

                        {/* Package Credits Option - Show prominently when credits are available */}
                        {!packagesLoading && categoryRemainingSessions > 0 && (
                            <div className="space-y-3">
                                {/* Highlighted banner when user has credits */}
                                <div className="bg-success/10 border border-success/30 rounded-lg p-3 flex items-center gap-2">
                                    <Gift className="h-4 w-4 text-success" />
                                    <p className="text-sm text-success font-medium">
                                        You have {categoryRemainingSessions} session credit{categoryRemainingSessions !== 1 ? 's' : ''} available!
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setUsePackageCredits(true);
                                        setHasUserMadePaymentChoice(true);
                                        // Auto-select first available matching-category package
                                        const firstPackage = categoryPackages[0];
                                        if (firstPackage) {
                                            setSelectedPackageId(
                                                firstPackage.id
                                            );
                                        }
                                    }}
                                    className={cn(
                                        'w-full p-4 rounded-xl border-2 text-left transition-all cursor-pointer',
                                        usePackageCredits
                                            ? 'border-success bg-success/5 ring-2 ring-success/20'
                                            : 'border-border hover:border-success/50 hover:bg-success/5'
                                    )}>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-success/10">
                                            <Gift className="h-5 w-5 text-success" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-foreground">
                                                    Use Package Credit
                                                </p>
                                                <Badge className="bg-success/10 text-success border-success/20 text-xs">
                                                    {categoryRemainingSessions}{' '}
                                                    available
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                Book using your pre-purchased
                                                session credits - no payment needed
                                            </p>
                                        </div>
                                        {usePackageCredits && (
                                            <CheckCircle className="h-5 w-5 text-success" />
                                        )}
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setUsePackageCredits(false);
                                        setSelectedPackageId(null);
                                        setHasUserMadePaymentChoice(true);
                                    }}
                                    className={cn(
                                        'w-full p-4 rounded-xl border-2 text-left transition-all cursor-pointer',
                                        !usePackageCredits
                                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                            : 'border-border hover:border-primary/50 hover:bg-primary/5'
                                    )}>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-primary/10">
                                            <CreditCard className="h-5 w-5 text-primary" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-semibold text-foreground">
                                                Pay €{selectedTypeData?.price}
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                Pay for this individual session
                                            </p>
                                        </div>
                                        {!usePackageCredits && (
                                            <CheckCircle className="h-5 w-5 text-primary" />
                                        )}
                                    </div>
                                </button>
                            </div>
                        )}

                        {/* Standard payment option when no packages (only show after packages have loaded) */}
                        {!packagesLoading &&
                            categoryRemainingSessions === 0 &&
                            selectedTypeData?.price &&
                            parseFloat(selectedTypeData.price) > 0 && (
                                <div className="space-y-3">
                                    <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-muted-foreground">
                                                Session fee
                                            </span>
                                            <span className="text-lg font-bold text-primary">
                                                €{selectedTypeData.price}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}

                        {/* Coupon code - only show when paying */}
                        {!usePackageCredits &&
                            selectedTypeData?.price &&
                            parseFloat(selectedTypeData.price) > 0 && (
                                <div className="space-y-2">
                                    <Label htmlFor="couponCode">
                                        Coupon Code (optional)
                                    </Label>
                                    <Input
                                        id="couponCode"
                                        value={couponCode}
                                        onChange={(e) =>
                                            setCouponCode(
                                                e.target.value.toUpperCase()
                                            )
                                        }
                                        placeholder="Enter coupon code"
                                        className="uppercase"
                                    />
                                </div>
                            )}

                        {/* Referral credit - only when paying by card and you have credit */}
                        {!usePackageCredits &&
                            selectedTypeData?.price &&
                            parseFloat(selectedTypeData.price) > 0 &&
                            referralBalanceCents > 0 && (() => {
                                const priceCents = Math.round(parseFloat(selectedTypeData.price) * 100);
                                const newTotal = Math.max(priceCents - referralBalanceCents, 0);
                                return (
                                    <button
                                        type="button"
                                        onClick={() => setApplyReferralCredit((v) => !v)}
                                        className={cn(
                                            'w-full p-4 rounded-xl border-2 text-left transition-all',
                                            applyReferralCredit
                                                ? 'border-success bg-success/5 ring-2 ring-success/20'
                                                : 'border-border hover:border-success/50 hover:bg-success/5'
                                        )}>
                                        <div className="flex items-center gap-3">
                                            <Checkbox
                                                checked={applyReferralCredit}
                                                className="pointer-events-none"
                                            />
                                            <div className="p-2 rounded-lg bg-success/10">
                                                <Gift className="h-5 w-5 text-success" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-semibold text-foreground">
                                                    Apply €{(referralBalanceCents / 100).toFixed(0)} referral credit
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    {applyReferralCredit
                                                        ? newTotal === 0
                                                            ? 'Covers the full price — €0 to pay'
                                                            : `You'll pay €${(newTotal / 100).toFixed(2)} instead of €${selectedTypeData.price}`
                                                        : 'Use your credit to reduce the price'}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })()}

                        <div className="flex gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => setStep('details')}
                                className="flex-1">
                                Back
                            </Button>
                            <Button
                                onClick={handleProceedToPayment}
                                className="flex-1 gap-2"
                                disabled={isSubmitting}>
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        {usePackageCredits
                                            ? 'Booking...'
                                            : 'Processing...'}
                                    </>
                                ) : usePackageCredits ? (
                                    <>
                                        <Gift className="h-4 w-4" />
                                        Book Session
                                    </>
                                ) : (
                                    <>
                                        <CreditCard className="h-4 w-4" />
                                        Continue to Payment
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                );

            case 'payment': {
                console.log('[Stripe Debug] Rendering payment step');
                console.log(
                    '[Stripe Debug] clientSecret exists:',
                    !!clientSecret
                );
                console.log('[Stripe Debug] paymentIntentId:', paymentIntentId);
                console.log(
                    '[Stripe Debug] stripePromise exists:',
                    !!stripePromise
                );
                console.log('[Stripe Debug] paymentAmount:', paymentAmount);
                console.log('[Stripe Debug] paymentLivemode:', paymentLivemode);

                if (!clientSecret || !paymentIntentId) {
                    console.log(
                        '[Stripe Debug] Missing clientSecret or paymentIntentId, returning null'
                    );
                    return null;
                }

                if (!stripePromise) {
                    console.log(
                        '[Stripe Debug] No stripePromise - missing publishable key'
                    );
                    return (
                        <div className="space-y-4">
                            <p className="text-sm text-destructive">
                                Payments are not configured: missing Stripe
                                publishable key.
                            </p>
                            <Button
                                variant="ghost"
                                onClick={() => setStep('confirm')}
                                className="w-full">
                                Back
                            </Button>
                        </div>
                    );
                }

                const publishableMode = stripePublishableKey?.startsWith(
                    'pk_live_'
                )
                    ? 'live'
                    : stripePublishableKey?.startsWith('pk_test_')
                    ? 'test'
                    : 'unknown';

                const intentMode =
                    paymentLivemode === null
                        ? 'unknown'
                        : paymentLivemode
                        ? 'live'
                        : 'test';
                const modeMismatch =
                    publishableMode !== 'unknown' &&
                    intentMode !== 'unknown' &&
                    publishableMode !== intentMode;

                console.log('[Stripe Debug] publishableMode:', publishableMode);
                console.log('[Stripe Debug] intentMode:', intentMode);
                console.log('[Stripe Debug] modeMismatch:', modeMismatch);

                if (modeMismatch) {
                    console.log('[Stripe Debug] Mode mismatch detected!');
                    return (
                        <div className="space-y-4">
                            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                                <p className="font-medium text-destructive">
                                    Stripe keys mismatch
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Your frontend is using{' '}
                                    <span className="font-medium">
                                        {publishableMode}
                                    </span>{' '}
                                    publishable key, but the payment was created
                                    in{' '}
                                    <span className="font-medium">
                                        {intentMode}
                                    </span>{' '}
                                    mode. Update your backend Stripe secret key
                                    to the same mode (test vs live).
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                onClick={() => setStep('confirm')}
                                className="w-full">
                                Back
                            </Button>
                        </div>
                    );
                }

                console.log(
                    '[Stripe Debug] Rendering Elements with clientSecret'
                );
                return (
                    <Elements
                        stripe={stripePromise}
                        options={{
                            clientSecret,
                            appearance: {
                                theme: 'stripe',
                                variables: {
                                    colorPrimary: '#7c3aed',
                                    borderRadius: '8px',
                                },
                            },
                        }}>
                        <PaymentForm
                            paymentIntentId={paymentIntentId}
                            amount={paymentAmount}
                            onSuccess={handlePaymentSuccess}
                            onBack={() => setStep('confirm')}
                        />
                    </Elements>
                );
            }

            case 'success':
                return (
                    <div className="flex flex-col items-center justify-center py-6 space-y-6">
                        <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center">
                            <CheckCircle className="h-10 w-10 text-green-600" />
                        </div>
                        <div className="text-center space-y-2">
                            <h3 className="font-semibold text-xl">
                                Booking Confirmed!
                            </h3>
                            <p className="text-muted-foreground">
                                Your session has been booked successfully.
                            </p>
                        </div>

                        {bookingResult?.appointment && (
                            <div className="bg-accent/50 rounded-xl p-4 w-full space-y-2">
                                <p className="font-medium">
                                    {bookingResult.appointment.type}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    with {bookingResult.appointment.therapist}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {new Date(
                                        bookingResult.appointment.datetime
                                    ).toLocaleString('en-IE', {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </p>
                            </div>
                        )}

                        <p className="text-sm text-muted-foreground text-center">
                            A confirmation email has been sent to{' '}
                            {formData.email}
                        </p>

                        <Button onClick={handleClose} className="w-full">
                            Done
                        </Button>
                    </div>
                );
        }
    };

    const getStepTitle = () => {
        const categoryLabel = getSessionCategoryLabel();
        switch (step) {
            case 'type':
                return sessionCategory === 'couples' ||
                    sessionCategory === 'youth'
                    ? `${categoryLabel} - Choose Therapist`
                    : `${categoryLabel} - Choose Session`;
            case 'therapist':
                return 'Choose Your Therapist';
            case 'date':
                return 'Select Date';
            case 'time':
                return 'Select Time';
            case 'details':
                return 'Your Details';
            case 'confirm':
                return 'Confirm Booking';
            case 'payment':
                return 'Payment';
            case 'success':
                return 'Booking Complete';
        }
    };

    // Progress indicator steps (excluding success which is the final state)
    const progressSteps = [
        { key: 'type', label: 'Type' },
        { key: 'therapist', label: 'Therapist' },
        { key: 'date', label: 'Date' },
        { key: 'time', label: 'Time' },
        { key: 'details', label: 'Details' },
        { key: 'confirm', label: 'Confirm' },
        { key: 'payment', label: 'Payment' },
    ] as const;

    const currentStepIndex = progressSteps.findIndex((s) => s.key === step);
    const isSuccessStep = step === 'success';

    return (
        <Dialog
            open={open}
            onOpenChange={(newOpen) => {
                if (!newOpen && (step === 'payment' || isSubmitting)) {
                    // Prevent closing during payment or while booking is being submitted
                    return;
                }
                if (step === 'success') {
                    handleClose();
                } else {
                    onOpenChange(newOpen);
                }
            }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{getStepTitle()}</DialogTitle>
                </DialogHeader>

                {/* Progress Indicator */}
                {!isSuccessStep && (
                    <div className="flex items-center justify-center gap-1.5 pb-2">
                        {progressSteps.map((s, index) => (
                            <div
                                key={s.key}
                                className={cn(
                                    'h-1.5 rounded-full transition-all duration-300',
                                    index <= currentStepIndex
                                        ? 'bg-primary w-6'
                                        : 'bg-muted w-4'
                                )}
                                title={s.label}
                            />
                        ))}
                    </div>
                )}

                {renderStep()}
            </DialogContent>
        </Dialog>
    );
}
