import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { CustomerOnly } from "@/components/auth/CustomerOnly";
import { PaymentRedirectHandler } from "@/components/booking/PaymentRedirectHandler";
import { BundleFunnelResume } from "@/components/onboarding/BundleFunnelResume";
import Dashboard from "./pages/Dashboard";
import Sessions from "./pages/Sessions";
import Invoices from "./pages/Invoices";
import Profile from "./pages/Profile";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import BookingSuccess from "./pages/BookingSuccess";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsConditions from "./pages/TermsConditions";
import Admin from "./pages/Admin";
import Packages from "./pages/Packages";
import Referrals from "./pages/Referrals";
import Psychiatry from "./pages/Psychiatry";
import GetStarted from "./pages/GetStarted";
import HelpCenter from "./pages/HelpCenter";
import HelpArticle from "./pages/HelpArticle";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <PaymentRedirectHandler />
          <BundleFunnelResume />
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {/* Customer pages. CustomerOnly sends admins to /admin instead. */}
            <Route path="/dashboard" element={<ProtectedRoute><CustomerOnly><Dashboard /></CustomerOnly></ProtectedRoute>} />
            <Route path="/sessions" element={<ProtectedRoute><CustomerOnly><Sessions /></CustomerOnly></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute><CustomerOnly><Invoices /></CustomerOnly></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><CustomerOnly><Profile /></CustomerOnly></ProtectedRoute>} />
            <Route path="/referrals" element={<ProtectedRoute><CustomerOnly><Referrals /></CustomerOnly></ProtectedRoute>} />
            <Route path="/psychiatry" element={<ProtectedRoute><CustomerOnly><Psychiatry /></CustomerOnly></ProtectedRoute>} />
            <Route path="/get-started" element={<ProtectedRoute><CustomerOnly><GetStarted /></CustomerOnly></ProtectedRoute>} />
            <Route path="/booking-success" element={<ProtectedRoute><CustomerOnly><BookingSuccess /></CustomerOnly></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/admin/:section" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsConditions />} />
            <Route path="/packages" element={<CustomerOnly><Packages /></CustomerOnly>} />
            <Route path="/help" element={<CustomerOnly><HelpCenter /></CustomerOnly>} />
            <Route path="/help/:slug" element={<CustomerOnly><HelpArticle /></CustomerOnly>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
