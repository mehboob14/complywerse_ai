'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complianceCalendarApi } from '@/lib/api';
import {
  Calendar,
  CalendarDays,
  List,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
  CheckCircle,
  X,
  Edit,
  Trash2,
  Eye,
  Target,
  Shield,
  FileText,
  Award,
  Layers,
  Tag,
} from 'lucide-react';

const EVENT_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'assessment_due', label: 'Assessment Due' },
  { value: 'certification_renewal', label: 'Certification Renewal' },
  { value: 'policy_review', label: 'Policy Review' },
  { value: 'audit_deadline', label: 'Audit Deadline' },
  { value: 'framework_deadline', label: 'Framework Deadline' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'due_soon', label: 'Due Soon' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
];

const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string; dot: string; badge: string }> = {
  assessment_due: { bg: 'bg-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-500', badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  certification_renewal: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-500', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  policy_review: { bg: 'bg-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-500', badge: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  audit_deadline: { bg: 'bg-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-500', badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  framework_deadline: { bg: 'bg-rose-500/20', text: 'text-rose-400', dot: 'bg-rose-500', badge: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  custom: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', dot: 'bg-cyan-500', badge: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
};

const STATUS_BADGE: Record<string, string> = {
  upcoming: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  due_soon: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  overdue: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-slate-400',
  medium: 'text-blue-400',
  high: 'text-amber-400',
  critical: 'text-rose-400',
};

const EVENT_TYPE_ICONS: Record<string, React.ElementType> = {
  assessment_due: Target,
  certification_renewal: Award,
  policy_review: FileText,
  audit_deadline: Shield,
  framework_deadline: Layers,
  custom: Tag,
};

function formatEventType(type: string) {
  return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

interface CalendarEvent {
  id: number;
  title: string;
  description?: string;
  event_type: string;
  due_date: string;
  priority: string;
  status: string;
  assigned_to?: string;
  recurrence_type?: string;
  created_at?: string;
}

export default function ComplianceCalendarPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'month' | 'list'>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  const dateFrom = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
  const dateTo = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${getDaysInMonth(currentYear, currentMonth)}`;

  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ['compliance-calendar-events', dateFrom, dateTo, filterType, filterStatus],
    queryFn: async () => {
      const params: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
      if (filterType) params.event_type = filterType;
      if (filterStatus) params.status = filterStatus;
      const res = await complianceCalendarApi.getEvents(params);
      return res.data;
    },
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['compliance-calendar-summary'],
    queryFn: async () => {
      const res = await complianceCalendarApi.getSummary();
      return res.data;
    },
  });

  const events: CalendarEvent[] = useMemo(() => {
    if (!eventsData) return [];
    return Array.isArray(eventsData) ? eventsData : eventsData.events || [];
  }, [eventsData]);

  const eventsByDay = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    events.forEach((evt) => {
      const d = new Date(evt.due_date);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(evt);
      }
    });
    return map;
  }, [events, currentMonth, currentYear]);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => complianceCalendarApi.createEvent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-calendar'] });
      setShowCreateModal(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => complianceCalendarApi.updateEvent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-calendar'] });
      setEditingEvent(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => complianceCalendarApi.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-calendar'] });
      setSelectedEvent(null);
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => complianceCalendarApi.completeEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-calendar'] });
      setSelectedEvent(null);
    },
  });

  const navigateMonth = (dir: number) => {
    setCurrentDate(new Date(currentYear, currentMonth + dir, 1));
  };

  const summaryCards = [
    {
      label: 'Total Events',
      value: summaryData?.total_events ?? summaryData?.total ?? 0,
      icon: CalendarDays,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
    },
    {
      label: 'Upcoming',
      value: summaryData?.upcoming ?? summaryData?.upcoming_count ?? 0,
      icon: Clock,
      iconColor: 'text-blue-400',
      bgColor: 'from-blue-500/20 to-blue-600/10',
    },
    {
      label: 'Due Soon',
      value: summaryData?.due_soon ?? summaryData?.due_soon_count ?? 0,
      icon: AlertTriangle,
      iconColor: 'text-amber-400',
      bgColor: 'from-amber-500/20 to-amber-600/10',
    },
    {
      label: 'Overdue',
      value: summaryData?.overdue ?? summaryData?.overdue_count ?? 0,
      icon: AlertTriangle,
      iconColor: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/10',
    },
  ];

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;
  const todayDate = today.getDate();

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  if (eventsLoading && summaryLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-56 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Calendar className="h-7 w-7 text-primary-400" />
            Compliance Calendar
          </h1>
          <p className="text-slate-400 mt-1">Track and manage compliance deadlines, reviews, and certifications</p>
        </div>
        <button
          onClick={() => { setEditingEvent(null); setShowCreateModal(true); }}
          className="btn-primary"
        >
          <Plus size={18} />
          Add Event
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="stat-card hover:border-slate-600 transition-all duration-200">
            <div className="flex items-start justify-between mb-4">
              <div className={`rounded-xl bg-gradient-to-br ${card.bgColor} p-3`}>
                <card.icon className={`h-6 w-6 ${card.iconColor}`} />
              </div>
            </div>
            <p className="stat-value">{typeof card.value === 'number' ? card.value.toLocaleString() : card.value}</p>
            <p className="stat-label">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('month')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === 'month'
                ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <CalendarDays size={16} />
            Month
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === 'list'
                ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            <List size={16} />
            List
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
          >
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button onClick={() => navigateMonth(-1)} className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="px-4 py-2 text-sm font-medium text-white min-w-[160px] text-center">{monthName}</span>
            <button onClick={() => navigateMonth(1)} className="p-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {view === 'month' ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-700">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="px-2 py-3 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[100px] border-b border-r border-slate-700/50 bg-slate-800/30" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayEvents = eventsByDay[day] || [];
              const isToday = isCurrentMonth && todayDate === day;
              return (
                <div
                  key={day}
                  className={`min-h-[100px] border-b border-r border-slate-700/50 p-1.5 transition-colors hover:bg-slate-700/30 ${
                    isToday ? 'bg-primary-500/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday ? 'bg-primary-500 text-white' : 'text-slate-400'
                    }`}>
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[10px] text-slate-500">{dayEvents.length}</span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((evt) => {
                      const colors = EVENT_TYPE_COLORS[evt.event_type] || EVENT_TYPE_COLORS.custom;
                      return (
                        <button
                          key={evt.id}
                          onClick={() => setSelectedEvent(evt)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-medium truncate ${colors.bg} ${colors.text} hover:opacity-80 transition-opacity`}
                        >
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${colors.dot} mr-1`} />
                          {evt.title}
                        </button>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <span className="text-[10px] text-slate-500 pl-1">+{dayEvents.length - 3} more</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Title</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Due Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Priority</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Assigned To</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center">
                      <CalendarDays className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                      <p className="text-slate-400 text-sm">No events found for this period</p>
                    </td>
                  </tr>
                ) : (
                  events.map((evt) => {
                    const typeColors = EVENT_TYPE_COLORS[evt.event_type] || EVENT_TYPE_COLORS.custom;
                    const statusBadge = STATUS_BADGE[evt.status] || STATUS_BADGE.upcoming;
                    const priorityColor = PRIORITY_COLORS[evt.priority] || PRIORITY_COLORS.medium;
                    return (
                      <tr key={evt.id} className="hover:bg-slate-700/30 transition-colors">
                        <td className="px-4 py-3">
                          <button onClick={() => setSelectedEvent(evt)} className="text-sm font-medium text-white hover:text-primary-400 transition-colors text-left">
                            {evt.title}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors.badge}`}>
                            {formatEventType(evt.event_type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-300">
                          {new Date(evt.due_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-medium capitalize ${priorityColor}`}>{evt.priority}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge}`}>
                            {formatEventType(evt.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-400">{evt.assigned_to || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {evt.status !== 'completed' && (
                              <button
                                onClick={() => completeMutation.mutate(evt.id)}
                                className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 transition-colors"
                                title="Complete"
                              >
                                <CheckCircle size={15} />
                              </button>
                            )}
                            <button
                              onClick={() => { setEditingEvent(evt); setShowCreateModal(true); }}
                              className="p-1.5 rounded-lg hover:bg-blue-500/20 text-slate-400 hover:text-blue-400 transition-colors"
                              title="Edit"
                            >
                              <Edit size={15} />
                            </button>
                            <button
                              onClick={() => { if (confirm('Delete this event?')) deleteMutation.mutate(evt.id); }}
                              className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onComplete={(id) => completeMutation.mutate(id)}
          onEdit={(evt) => { setSelectedEvent(null); setEditingEvent(evt); setShowCreateModal(true); }}
          onDelete={(id) => { if (confirm('Delete this event?')) deleteMutation.mutate(id); }}
        />
      )}

      {showCreateModal && (
        <CreateEditEventModal
          event={editingEvent}
          onClose={() => { setShowCreateModal(false); setEditingEvent(null); }}
          onSubmit={(data) => {
            if (editingEvent) {
              updateMutation.mutate({ id: editingEvent.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
}

function EventDetailPanel({
  event,
  onClose,
  onComplete,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  onClose: () => void;
  onComplete: (id: number) => void;
  onEdit: (evt: CalendarEvent) => void;
  onDelete: (id: number) => void;
}) {
  const typeColors = EVENT_TYPE_COLORS[event.event_type] || EVENT_TYPE_COLORS.custom;
  const statusBadge = STATUS_BADGE[event.status] || STATUS_BADGE.upcoming;
  const priorityColor = PRIORITY_COLORS[event.priority] || PRIORITY_COLORS.medium;
  const TypeIcon = EVENT_TYPE_ICONS[event.event_type] || Tag;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-slate-900 border-l border-slate-700 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary-400" />
            Event Details
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <div className="flex items-start gap-3 mb-4">
              <div className={`rounded-lg ${typeColors.bg} p-2.5`}>
                <TypeIcon className={`h-5 w-5 ${typeColors.text}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-lg font-semibold text-white">{event.title}</h4>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mt-1 ${typeColors.badge}`}>
                  {formatEventType(event.event_type)}
                </span>
              </div>
            </div>
            {event.description && (
              <p className="text-sm text-slate-400 leading-relaxed">{event.description}</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-slate-800">
              <span className="text-sm text-slate-400">Due Date</span>
              <span className="text-sm font-medium text-white">{new Date(event.due_date).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-800">
              <span className="text-sm text-slate-400">Priority</span>
              <span className={`text-sm font-medium capitalize ${priorityColor}`}>{event.priority}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-800">
              <span className="text-sm text-slate-400">Status</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusBadge}`}>
                {formatEventType(event.status)}
              </span>
            </div>
            {event.assigned_to && (
              <div className="flex items-center justify-between py-2 border-b border-slate-800">
                <span className="text-sm text-slate-400">Assigned To</span>
                <span className="text-sm font-medium text-white">{event.assigned_to}</span>
              </div>
            )}
            {event.recurrence_type && event.recurrence_type !== 'none' && (
              <div className="flex items-center justify-between py-2 border-b border-slate-800">
                <span className="text-sm text-slate-400">Recurrence</span>
                <span className="text-sm font-medium text-white capitalize">{event.recurrence_type}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-4">
            {event.status !== 'completed' && (
              <button
                onClick={() => onComplete(event.id)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 transition-colors text-sm font-medium"
              >
                <CheckCircle size={16} />
                Complete
              </button>
            )}
            <button
              onClick={() => onEdit(event)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors text-sm font-medium"
            >
              <Edit size={16} />
              Edit
            </button>
            <button
              onClick={() => onDelete(event.id)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg hover:bg-rose-500/30 transition-colors text-sm font-medium"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateEditEventModal({
  event,
  onClose,
  onSubmit,
  isLoading,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: event?.title || '',
    description: event?.description || '',
    event_type: event?.event_type || 'assessment_due',
    due_date: event?.due_date ? event.due_date.split('T')[0] : '',
    priority: event?.priority || 'medium',
    assigned_to: event?.assigned_to || '',
    recurrence_type: event?.recurrence_type || 'none',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const inputClass = "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500";
  const labelClass = "block text-sm font-medium text-slate-300 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between z-10 rounded-t-xl">
          <h3 className="text-lg font-semibold text-white">
            {event ? 'Edit Event' : 'Create Event'}
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelClass}>Title *</label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={inputClass}
              placeholder="Event title"
            />
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className={`${inputClass} h-20 resize-none`}
              placeholder="Event description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Event Type *</label>
              <select
                value={formData.event_type}
                onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
                className={inputClass}
              >
                {EVENT_TYPE_OPTIONS.filter(o => o.value).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Due Date *</label>
              <input
                type="date"
                required
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Priority</label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className={inputClass}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Recurrence</label>
              <select
                value={formData.recurrence_type}
                onChange={(e) => setFormData({ ...formData, recurrence_type: e.target.value })}
                className={inputClass}
              >
                {RECURRENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Assigned To</label>
            <input
              type="text"
              value={formData.assigned_to}
              onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
              className={inputClass}
              placeholder="Person or team"
            />
          </div>

          <div className="flex items-center gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 btn-primary disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
