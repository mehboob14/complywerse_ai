'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { useRouter } from '@/lib/navigation';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Clock,
  CheckCircle,
  FileText,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
  ArrowLeft,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'wouter';

interface ReviewDocument {
  id: number;
  tenant_id: number;
  document_code: string | null;
  title: string;
  doc_type: string;
  classification: string;
  status: string;
  current_version: string;
  owner_id: number | null;
  owner_name: string | null;
  review_cycle_months: number;
  next_review_date: string | null;
  last_reviewed_at: string | null;
  last_reviewed_by: number | null;
  last_reviewer_name: string | null;
  days_until_review: number | null;
  is_overdue: boolean;
  effective_date: string | null;
  expiry_date: string | null;
}

interface CalendarDocument {
  id: number;
  title: string;
  doc_type: string;
  next_review_date: string;
  owner_name: string | null;
}

interface CalendarPeriod {
  period: string;
  label: string;
  documents: CalendarDocument[];
  count: number;
}

interface CalendarResponse {
  calendar: CalendarPeriod[];
  summary: {
    year: number;
    month: number | null;
    group_by: string;
    total_reviews: number;
    periods_with_reviews: number;
  };
}

interface ReviewListResponse {
  items: ReviewDocument[];
  total: number;
  skip: number;
  limit: number;
}

const DOCUMENT_TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string; bgColor: string; label: string }> = {
  policy: { icon: BookOpen, color: 'text-purple-700', bgColor: 'bg-purple-100', label: 'Policy' },
  standard: { icon: FileCheck, color: 'text-blue-700', bgColor: 'bg-blue-100', label: 'Standard' },
  procedure: { icon: ClipboardList, color: 'text-green-700', bgColor: 'bg-green-100', label: 'Procedure' },
  guideline: { icon: Lightbulb, color: 'text-yellow-700', bgColor: 'bg-yellow-100', label: 'Guideline' },
  charter: { icon: Shield, color: 'text-cyan-700', bgColor: 'bg-cyan-100', label: 'Charter' },
  framework: { icon: Layers, color: 'text-orange-700', bgColor: 'bg-orange-100', label: 'Framework' },
};

const getTypeConfig = (type: string) => {
  return DOCUMENT_TYPE_CONFIG[type] || { icon: FileText, color: 'text-gray-700', bgColor: 'bg-gray-100', label: type };
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  documents: CalendarDocument[];
}

export default function ReviewCalendarPage() {
  const router = useRouter();
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { data: calendarData, isLoading: calendarLoading } = useQuery({
    queryKey: ['governance-review-calendar', currentYear, currentMonth + 1],
    queryFn: async () => {
      const response = await governanceApi.getReviewCalendar({
        year: currentYear,
        month: currentMonth + 1,
      });
      return response.data as CalendarResponse;
    },
  });

  const { data: overdueData, isLoading: overdueLoading } = useQuery({
    queryKey: ['governance-reviews-overdue-calendar'],
    queryFn: async () => {
      const response = await governanceApi.getOverdueReviews({});
      return response.data as ReviewListResponse;
    },
  });

  const { data: upcomingData, isLoading: upcomingLoading } = useQuery({
    queryKey: ['governance-reviews-upcoming-calendar'],
    queryFn: async () => {
      const response = await governanceApi.getUpcomingReviews({ days: 30 });
      return response.data as ReviewListResponse;
    },
  });

  const documentsByDate = useMemo(() => {
    const map = new Map<string, CalendarDocument[]>();
    if (calendarData?.calendar) {
      calendarData.calendar.forEach(period => {
        period.documents.forEach(doc => {
          if (doc.next_review_date) {
            const dateKey = doc.next_review_date.split('T')[0];
            if (!map.has(dateKey)) {
              map.set(dateKey, []);
            }
            map.get(dateKey)!.push(doc);
          }
        });
      });
    }
    return map;
  }, [calendarData]);

  const calendarDays = useMemo((): CalendarDay[] => {
    const days: CalendarDay[] = [];
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const startingDayOfWeek = firstDayOfMonth.getDay();
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
    
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(currentYear, currentMonth - 1, prevMonthLastDay - i);
      const dateKey = date.toISOString().split('T')[0];
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        documents: documentsByDate.get(dateKey) || [],
      });
    }

    for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
      const date = new Date(currentYear, currentMonth, day);
      const dateKey = date.toISOString().split('T')[0];
      const isToday = 
        date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
      
      days.push({
        date,
        isCurrentMonth: true,
        isToday,
        documents: documentsByDate.get(dateKey) || [],
      });
    }

    const remainingDays = 42 - days.length;
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(currentYear, currentMonth + 1, day);
      const dateKey = date.toISOString().split('T')[0];
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        documents: documentsByDate.get(dateKey) || [],
      });
    }

    return days;
  }, [currentMonth, currentYear, documentsByDate, today]);

  const getReviewStatus = (reviewDate: string): 'overdue' | 'due-soon' | 'upcoming' => {
    const date = new Date(reviewDate);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'overdue';
    if (diffDays <= 7) return 'due-soon';
    return 'upcoming';
  };

  const getStatusColor = (status: 'overdue' | 'due-soon' | 'upcoming') => {
    switch (status) {
      case 'overdue':
        return 'bg-red-500';
      case 'due-soon':
        return 'bg-yellow-500';
      case 'upcoming':
        return 'bg-green-500';
    }
  };

  const getStatusBorderColor = (status: 'overdue' | 'due-soon' | 'upcoming') => {
    switch (status) {
      case 'overdue':
        return 'border-red-500/50';
      case 'due-soon':
        return 'border-yellow-500/50';
      case 'upcoming':
        return 'border-green-500/50';
    }
  };

  const navigateToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const navigateToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const navigateToToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
  };

  const handleDateClick = (day: CalendarDay) => {
    if (day.documents.length > 0) {
      setSelectedDate(day.date);
    }
  };

  const handleDocumentClick = (documentId: number) => {
    router.push(`/governance/documents?id=${documentId}`);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getDaysUntilDisplay = (days: number | null, isOverdue: boolean) => {
    if (days === null) return { text: '-', className: 'text-gray-600' };
    
    if (isOverdue || days < 0) {
      const absDays = Math.abs(days);
      return {
        text: `${absDays} day${absDays !== 1 ? 's' : ''} overdue`,
        className: 'text-red-600 font-medium',
      };
    }
    
    if (days === 0) {
      return { text: 'Due today', className: 'text-yellow-700 font-medium' };
    }
    
    if (days <= 7) {
      return { text: `${days} day${days !== 1 ? 's' : ''} left`, className: 'text-yellow-700' };
    }
    
    return { text: `${days} days left`, className: 'text-green-700' };
  };

  const isLoading = calendarLoading || overdueLoading || upcomingLoading;
  const overdueDocuments = overdueData?.items || [];
  const upcomingDocuments = upcomingData?.items || [];

  const selectedDateDocuments = selectedDate
    ? documentsByDate.get(selectedDate.toISOString().split('T')[0]) || []
    : [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1 flex items-center gap-3">
            <Link
              href="/governance/reviews"
              className="flex items-center gap-1 text-gray-600 hover:text-black transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to Reviews</span>
            </Link>
          </div>
          <h1 className="text-lg sm:text-xl font-semibold text-black">Review Calendar</h1>
          <p className="text-xs sm:text-sm text-gray-600">Visual overview of upcoming document reviews</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-red-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-xs text-gray-600">Overdue</p>
              <p className="text-2xl font-bold text-red-700">
                {overdueLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : overdueDocuments.length}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-yellow-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-2">
              <Clock className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-gray-600">Due This Week</p>
              <p className="text-2xl font-bold text-yellow-700">
                {upcomingLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  upcomingDocuments.filter(d => d.days_until_review !== null && d.days_until_review <= 7).length
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-green-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-gray-600">Upcoming (30 days)</p>
              <p className="text-2xl font-bold text-green-700">
                {upcomingLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : upcomingDocuments.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button
                onClick={navigateToPreviousMonth}
                className="rounded-lg bg-gray-100 p-2 text-gray-700 hover:bg-gray-200 hover:text-black transition-colors"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={navigateToNextMonth}
                className="rounded-lg bg-gray-100 p-2 text-gray-700 hover:bg-gray-200 hover:text-black transition-colors"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <h2 className="text-xl font-semibold text-black">
              {MONTHS[currentMonth]} {currentYear}
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-red-500"></span>
                <span className="text-gray-600">Overdue</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-yellow-500"></span>
                <span className="text-gray-600">Due Soon</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-green-500"></span>
                <span className="text-gray-600">Upcoming</span>
              </div>
            </div>
            <button
              onClick={navigateToToday}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 hover:text-black transition-colors"
            >
              Today
            </button>
          </div>
        </div>

        {calendarLoading ? (
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-7 gap-px mb-2">
              {WEEKDAYS.map(day => (
                <div key={day} className="p-2 text-center text-sm font-medium text-gray-600">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((day, index) => {
                const hasDocuments = day.documents.length > 0;
                const primaryStatus = hasDocuments
                  ? getReviewStatus(day.documents[0].next_review_date)
                  : null;
                
                return (
                  <div
                    key={index}
                    onClick={() => handleDateClick(day)}
                    className={`
                      min-h-[80px] rounded-lg border p-2 transition-all
                      ${day.isCurrentMonth ? 'bg-white' : 'bg-gray-50'}
                      ${day.isToday ? 'border-primary-500 ring-1 ring-primary-500/50' : 'border-gray-200'}
                      ${hasDocuments ? 'cursor-pointer hover:bg-gray-100' : ''}
                      ${selectedDate && day.date.toDateString() === selectedDate.toDateString() ? 'ring-2 ring-primary-400' : ''}
                    `}
                  >
                    <div className={`text-sm font-medium mb-1 ${
                      day.isCurrentMonth 
                        ? day.isToday 
                          ? 'text-primary-400' 
                          : 'text-black'
                        : 'text-gray-500'
                    }`}>
                      {day.date.getDate()}
                    </div>
                    
                    {hasDocuments && (
                      <div className="space-y-1">
                        {day.documents.slice(0, 2).map((doc, docIndex) => {
                          const status = getReviewStatus(doc.next_review_date);
                          return (
                            <div
                              key={docIndex}
                              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs truncate border ${getStatusBorderColor(status)} bg-gray-100`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${getStatusColor(status)}`}></span>
                              <span className="truncate text-gray-800">{doc.title}</span>
                            </div>
                          );
                        })}
                        {day.documents.length > 2 && (
                          <div className="text-xs text-gray-600 px-1">
                            +{day.documents.length - 2} more
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selectedDate && selectedDateDocuments.length > 0 && (
        <div className="rounded-xl border border-primary-200 bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-black">
              Reviews for {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            <button
              onClick={() => setSelectedDate(null)}
              className="text-sm text-gray-600 hover:text-black"
            >
              Clear selection
            </button>
          </div>
          <div className="space-y-2">
            {selectedDateDocuments.map(doc => {
              const typeConfig = getTypeConfig(doc.doc_type);
              const TypeIcon = typeConfig.icon;
              const status = getReviewStatus(doc.next_review_date);
              
              return (
                <div
                  key={doc.id}
                  onClick={() => handleDocumentClick(doc.id)}
                  className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors hover:bg-gray-100 ${getStatusBorderColor(status)} bg-gray-50`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 ${typeConfig.bgColor}`}>
                      <TypeIcon className={`h-4 w-4 ${typeConfig.color}`} />
                    </div>
                    <div>
                      <p className="font-medium text-black">{doc.title}</p>
                      <p className="text-sm text-gray-600">
                        {typeConfig.label} {doc.owner_name && `• ${doc.owner_name}`}
                      </p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-gray-600" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-red-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 p-4">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <h3 className="text-lg font-semibold text-black">Overdue Reviews</h3>
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {overdueDocuments.length}
            </span>
          </div>
          
          <div className="p-4">
            {overdueLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            ) : overdueDocuments.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-gray-600">
                <CheckCircle className="h-8 w-8 mb-2" />
                <p className="text-sm">No overdue reviews</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {overdueDocuments.slice(0, 10).map(doc => {
                  const typeConfig = getTypeConfig(doc.doc_type);
                  const TypeIcon = typeConfig.icon;
                  const daysDisplay = getDaysUntilDisplay(doc.days_until_review, doc.is_overdue);
                  
                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleDocumentClick(doc.id)}
                      className="flex items-center justify-between rounded-lg border border-red-200 bg-gray-50 p-3 cursor-pointer transition-colors hover:bg-gray-100"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`rounded-lg p-2 ${typeConfig.bgColor} flex-shrink-0`}>
                          <TypeIcon className={`h-4 w-4 ${typeConfig.color}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-black truncate">{doc.title}</p>
                          <p className="text-xs text-gray-600">
                            Due: {formatDate(doc.next_review_date || '')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs ${daysDisplay.className}`}>{daysDisplay.text}</span>
                        <ExternalLink className="h-4 w-4 text-gray-600" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-green-200 bg-white overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-200 p-4">
            <CalendarIcon className="h-5 w-5 text-green-400" />
            <h3 className="text-lg font-semibold text-black">Upcoming Reviews</h3>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {upcomingDocuments.length}
            </span>
          </div>
          
          <div className="p-4">
            {upcomingLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
              </div>
            ) : upcomingDocuments.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-gray-600">
                <CalendarIcon className="h-8 w-8 mb-2" />
                <p className="text-sm">No upcoming reviews</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {upcomingDocuments.slice(0, 10).map(doc => {
                  const typeConfig = getTypeConfig(doc.doc_type);
                  const TypeIcon = typeConfig.icon;
                  const daysDisplay = getDaysUntilDisplay(doc.days_until_review, doc.is_overdue);
                  const isDueSoon = doc.days_until_review !== null && doc.days_until_review <= 7;
                  
                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleDocumentClick(doc.id)}
                      className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors hover:bg-gray-100 ${
                        isDueSoon ? 'border-yellow-200' : 'border-green-200'
                      } bg-gray-50`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`rounded-lg p-2 ${typeConfig.bgColor} flex-shrink-0`}>
                          <TypeIcon className={`h-4 w-4 ${typeConfig.color}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-black truncate">{doc.title}</p>
                          <p className="text-xs text-gray-600">
                            Due: {formatDate(doc.next_review_date || '')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-xs ${daysDisplay.className}`}>{daysDisplay.text}</span>
                        <ExternalLink className="h-4 w-4 text-gray-600" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
