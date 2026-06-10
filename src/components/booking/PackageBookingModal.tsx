import { useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { PackagePaymentForm } from './PackagePaymentForm';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, Gift, Loader2, Sparkles, TrendingDown, CheckCircle, Receipt, ExternalLink, Heart, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

// Initialize Stripe
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

interface PackageBookingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'select' | 'details' | 'payment' | 'success';

type PackageCategory = 'individual' | 'youth' | 'couples';

// Package definitions
// Acuity links:
// Individual 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1122832
// Individual 6: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=996385
// Individual 9: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1197875
// Youth 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1370588
// Youth 5: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1975510
// Couples 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=2000708
// Couples 5: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1967869
const PACKAGES = [
  {
    id: 1122832,
    category: 'individual' as PackageCategory,
    name: "3 Session Bundle",
    sessions: 3,
    sessionDuration: 50,
    price: 241.50,
    individualPrice: 85,
    savings: 13.50,
    popular: false
  },
  {
    id: 996385,
    category: 'individual' as PackageCategory,
    name: "6 Session Bundle",
    sessions: 6,
    sessionDuration: 50,
    price: 468,
    individualPrice: 85,
    savings: 42,
    popular: true
  },
  {
    id: 1197875,
    category: 'individual' as PackageCategory,
    name: "9 Session Bundle",
    sessions: 9,
    sessionDuration: 50,
    price: 675,
    individualPrice: 85,
    savings: 90,
    popular: false
  },
  {
    id: 1370588,
    category: 'youth' as PackageCategory,
    name: "Youth Bundle 3 x 60min",
    sessions: 3,
    sessionDuration: 60,
    price: 305,
    individualPrice: 105,
    savings: 10,
    popular: false
  },
  {
    id: 1975510,
    category: 'youth' as PackageCategory,
    name: "Youth Bundle 5 x 60min",
    sessions: 5,
    sessionDuration: 60,
    price: 505,
    individualPrice: 105,
    savings: 20,
    popular: true
  },
  {
    id: 2000708,
    category: 'couples' as PackageCategory,
    name: "Couples 3 x 60 min",
    sessions: 3,
    sessionDuration: 60,
    price: 320,
    individualPrice: 110,
    savings: 10,
    popular: false
  },
  {
    id: 1967869,
    category: 'couples' as PackageCategory,
    name: "Couples 5 x 60 min",
    sessions: 5,
    sessionDuration: 60,
    price: 525,
    individualPrice: 110,
    savings: 25,
    popular: true
  },
];

const PACKAGE_CATEGORIES: { key: PackageCategory; label: string; icon: typeof Gift }[] = [
  { key: 'individual', label: 'Individual', icon: Gift },
  { key: 'youth', label: 'Youth', icon: Users },
  { key: 'couples', label: 'Couples', icon: Heart },
];

export function PackageBookingModal({ open, onOpenChange }: PackageBookingModalProps) {
  const [step, setStep] = useState<Step>('select');
  const [packageCategory, setPackageCategory] = useState<PackageCategory>('individual');
  const [selectedPackage, setSelectedPackage] = useState<typeof PACKAGES[0] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });
  
  // Payment state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [purchaseResult, setPurchaseResult] = useState<{ 
    package: any; 
    receiptUrl?: string 
  } | null>(null);

  const { toast } = useToast();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  // Pre-fill form data from profile
  const handleSelectPackage = (pkg: typeof PACKAGES[0]) => {
    setSelectedPackage(pkg);
    setFormData({
      firstName: profile?.first_name || '',
      lastName: profile?.last_name || '',
      email: profile?.email || '',
      phone: '',
    });
    setStep('details');
  };

  const handleProceedToPayment = async () => {
    if (!selectedPackage) return;

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-package-payment-intent', {
        body: {
          packageId: selectedPackage.id,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone || undefined,
        },
      });

      if (error) {
        if (data?.error) throw new Error(data.error);
        throw error;
      }
      if (data?.error) throw new Error(data.error);

      setClientSecret(data.clientSecret);
      setPaymentIntentId(data.paymentIntentId);
      setPaymentAmount(data.amount);
      setStep('payment');
    } catch (error) {
      console.error('Payment setup error:', error);
      toast({
        title: 'Payment Setup Failed',
        description: error instanceof Error ? error.message : 'Failed to initialize payment',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaymentSuccess = (result: { package: any; receiptUrl?: string }) => {
    setPurchaseResult(result);
    setStep('success');
    
    // Refresh packages query
    queryClient.invalidateQueries({ queryKey: ['user-packages'] });
    
    toast({
      title: 'Package Purchased!',
      description: `You now have ${result.package.sessions} sessions to use.`,
    });
  };

  const handleClose = () => {
    setStep('select');
    setPackageCategory('individual');
    setSelectedPackage(null);
    setFormData({ firstName: '', lastName: '', email: '', phone: '' });
    setClientSecret(null);
    setPaymentIntentId(null);
    setPaymentAmount(0);
    setPurchaseResult(null);
    onOpenChange(false);
  };

  const calculateSavings = (pkg: typeof PACKAGES[0]) => {
    const fullPrice = pkg.sessions * pkg.individualPrice;
    const savings = pkg.savings;
    const percentSaved = Math.round((savings / fullPrice) * 100);
    return { savings, percentSaved, fullPrice };
  };

  const getStepTitle = () => {
    switch (step) {
      case 'select': return 'Choose Your Package';
      case 'details': return 'Your Details';
      case 'payment': return 'Payment';
      case 'success': return 'Purchase Complete!';
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'select':
        return (
          <div className="space-y-4">
            <div className="text-center pb-2">
              <div className="inline-flex items-center gap-2 bg-success/10 text-success px-3 py-1.5 rounded-full text-sm font-medium mb-3">
                <Gift className="h-4 w-4" />
                Save with session bundles
              </div>
              <p className="text-muted-foreground text-sm">
                Commit to your wellbeing and save. Choose the package that fits your journey.
              </p>
            </div>

            <Tabs value={packageCategory} onValueChange={(value) => setPackageCategory(value as PackageCategory)}>
              <TabsList className="grid w-full grid-cols-3">
                {PACKAGE_CATEGORIES.map(({ key, label, icon: Icon }) => (
                  <TabsTrigger key={key} value={key} className="gap-1.5 text-xs sm:text-sm">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>

              {PACKAGE_CATEGORIES.map(({ key }) => (
                <TabsContent key={key} value={key} className="space-y-3 mt-3">
                  {PACKAGES.filter((pkg) => pkg.category === key).map((pkg) => {
                    const { savings, percentSaved, fullPrice } = calculateSavings(pkg);

                    return (
                      <button
                        key={pkg.id}
                        onClick={() => handleSelectPackage(pkg)}
                        className={cn(
                          "w-full p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50 hover:bg-accent/30 relative",
                          pkg.popular
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        )}
                      >
                        {pkg.popular && (
                          <Badge className="absolute -top-2 right-3 bg-primary text-primary-foreground">
                            <Sparkles className="h-3 w-3 mr-1" />
                            Most Popular
                          </Badge>
                        )}

                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-semibold text-lg text-foreground">{pkg.sessions} Sessions</h4>
                            <p className="text-sm text-muted-foreground">
                              {pkg.sessions} x {pkg.sessionDuration} minute sessions
                            </p>
                          </div>
                          <Badge className="bg-success/10 text-success border-success/20">
                            <TrendingDown className="h-3 w-3 mr-1" />
                            Save {percentSaved}%
                          </Badge>
                        </div>

                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-2xl font-bold text-primary">€{pkg.price}</span>
                          <span className="text-sm text-muted-foreground line-through">€{fullPrice}</span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Check className="h-3.5 w-3.5 text-success" />
                            €{Math.round(pkg.price / pkg.sessions)} per session
                          </span>
                          <span className="text-success font-medium">
                            You save €{savings}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </TabsContent>
              ))}
            </Tabs>

            <p className="text-xs text-center text-muted-foreground pt-2">
              {packageCategory === 'individual'
                ? 'Individual sessions are €85 each. Packages give you the flexibility to book sessions when you need them.'
                : packageCategory === 'youth'
                  ? 'Youth sessions are €105 each. Bundles apply to youth therapy sessions only.'
                  : 'Couples sessions are €110 each. Bundles apply to couples therapy sessions only.'}
            </p>
          </div>
        );

      case 'details':
        return (
          <div className="space-y-4">
            {selectedPackage && (
              <div className="bg-accent/50 rounded-xl p-4 mb-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">{selectedPackage.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedPackage.sessions} x {selectedPackage.sessionDuration} min sessions
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-primary">€{selectedPackage.price}</p>
                    <p className="text-xs text-success">Save €{calculateSavings(selectedPackage).savings}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={e => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={e => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
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
                onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="john@example.com"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="+353 1234567"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="ghost" onClick={() => setStep('select')} className="flex-1">
                Back
              </Button>
              <Button 
                onClick={handleProceedToPayment}
                disabled={!formData.firstName || !formData.lastName || !formData.email || isSubmitting}
                className="flex-1 gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>Continue to Payment</>
                )}
              </Button>
            </div>
          </div>
        );

      case 'payment':
        if (!clientSecret || !stripePromise || !paymentIntentId) {
          return (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading payment form...</p>
            </div>
          );
        }

        return (
          <Elements 
            stripe={stripePromise} 
            options={{ 
              clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: 'hsl(var(--primary))',
                },
              },
            }}
          >
            <PackagePaymentForm
              paymentIntentId={paymentIntentId}
              amount={paymentAmount}
              packageName={selectedPackage?.name || ''}
              onSuccess={handlePaymentSuccess}
              onBack={() => setStep('details')}
            />
          </Elements>
        );

      case 'success':
        return (
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className="h-20 w-20 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-success" />
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="text-xl font-semibold">Package Purchased!</h3>
              <p className="text-muted-foreground">
                You now have <span className="font-semibold text-foreground">{purchaseResult?.package?.sessions} sessions</span> ready to book.
              </p>
            </div>

            {purchaseResult?.receiptUrl && (
              <Button 
                variant="outline" 
                onClick={() => window.open(purchaseResult.receiptUrl, '_blank')}
                className="gap-2"
              >
                <Receipt className="h-4 w-4" />
                View Receipt
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}

            <div className="w-full pt-4">
              <Button onClick={handleClose} className="w-full">
                Start Booking Sessions
              </Button>
            </div>
          </div>
        );
    }
  };

  // Progress indicator
  const progressSteps = [
    { key: 'select', label: 'Package' },
    { key: 'details', label: 'Details' },
    { key: 'payment', label: 'Payment' },
    { key: 'success', label: 'Done' },
  ] as const;

  const currentStepIndex = progressSteps.findIndex(s => s.key === step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{getStepTitle()}</DialogTitle>
        </DialogHeader>
        
        {/* Progress Indicator */}
        {step !== 'success' && (
          <div className="flex items-center justify-center gap-1.5 pb-2">
            {progressSteps.map((s, index) => (
              <div
                key={s.key}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  index <= currentStepIndex 
                    ? "bg-primary w-8" 
                    : "bg-muted w-4"
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
