'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { rcsaApi } from '@/lib/api';
import {
  FileText,
  ArrowLeft,
  Save,
  Plus,
  Edit2,
  Trash2,
  GripVertical,
  X,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  HelpCircle,
  ToggleLeft,
  Type,
  List,
  Star,
  Shield,
} from 'lucide-react';
import Link from 'next/link';

interface Question {
  id: number;
  sequence?: number;
  question_order?: number;
  question_text: string;
  question_type: 'risk_rating' | 'control_rating' | 'yes_no' | 'text' | 'multiple_choice';
  options?: string[];
  is_required: boolean;
  category?: string;
  section?: string;
  weight?: number;
  guidance?: string;
  guidance_text?: string;
  risk_category?: string;
  control_objective?: string;
  ai_suggestion_enabled?: boolean;
}

interface Template {
  id: number;
  name: string;
  description: string;
  source: 'system' | 'custom';
  category: string;
  framework_type: string;
  question_count: number;
  questions: Question[];
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

const QUESTION_TYPES = [
  { value: 'risk_rating', label: 'Risk Rating', icon: Star, description: '1-5 risk severity scale' },
  { value: 'control_rating', label: 'Control Rating', icon: Shield, description: 'Control effectiveness rating' },
  { value: 'yes_no', label: 'Yes/No', icon: ToggleLeft, description: 'Binary yes/no question' },
  { value: 'text', label: 'Text', icon: Type, description: 'Free text response' },
  { value: 'multiple_choice', label: 'Multiple Choice', icon: List, description: 'Select from options' },
];

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  risk_rating: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  control_rating: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  yes_no: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  text: { bg: 'bg-primary-500/20', text: 'text-primary-600' },
  multiple_choice: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
};

export default function TemplateDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const templateId = Number(params.id);
  const isEditMode = searchParams.get('edit') === 'true';
  const queryClient = useQueryClient();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<number | null>(null);

  const { data: template, isLoading, error } = useQuery({
    queryKey: ['rcsa-template', templateId],
    queryFn: async () => {
      const response = await rcsaApi.getTemplate(templateId);
      const data = response.data;
      // Map backend fields to frontend expected format
      const mappedQuestions = (data.questions || []).map((q: Record<string, unknown>, index: number) => ({
        id: q.id,
        sequence: q.question_order || index + 1,
        question_order: q.question_order,
        question_text: q.question_text,
        question_type: q.question_type,
        options: q.options,
        is_required: q.is_required,
        category: q.section || q.risk_category,
        section: q.section,
        weight: 1,
        guidance: q.guidance_text,
        guidance_text: q.guidance_text,
        risk_category: q.risk_category,
        control_objective: q.control_objective,
        ai_suggestion_enabled: q.ai_suggestion_enabled,
      }));
      return {
        ...data,
        framework_type: data.category || 'Custom',
        questions: mappedQuestions,
      } as Template;
    },
  });

  useEffect(() => {
    if (template?.questions) {
      const sortedQuestions = [...template.questions].sort((a, b) => 
        (a.question_order || a.sequence || 0) - (b.question_order || b.sequence || 0)
      );
      setQuestions(sortedQuestions);
    }
  }, [template]);

  const saveMutation = useMutation({
    mutationFn: (data: { questions: Question[] }) => rcsaApi.updateTemplate(templateId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rcsa-template', templateId] });
      setHasChanges(false);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    const newQuestions = [...questions];
    const draggedItem = newQuestions[draggedIndex];
    newQuestions.splice(draggedIndex, 1);
    newQuestions.splice(index, 0, draggedItem);
    
    newQuestions.forEach((q, idx) => {
      q.sequence = idx + 1;
    });
    
    setQuestions(newQuestions);
    setDraggedIndex(index);
    setHasChanges(true);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleAddQuestion = (questionData: Partial<Question>) => {
    const newQuestion: Question = {
      id: Date.now(),
      sequence: questions.length + 1,
      question_text: questionData.question_text || '',
      question_type: questionData.question_type || 'text',
      options: questionData.options,
      is_required: questionData.is_required ?? true,
      category: questionData.category,
      weight: questionData.weight || 1,
      guidance: questionData.guidance,
    };
    setQuestions([...questions, newQuestion]);
    setHasChanges(true);
    setIsQuestionModalOpen(false);
  };

  const handleUpdateQuestion = (questionData: Partial<Question>) => {
    if (!editingQuestion) return;
    setQuestions(questions.map(q => 
      q.id === editingQuestion.id ? { ...q, ...questionData } : q
    ));
    setHasChanges(true);
    setEditingQuestion(null);
    setIsQuestionModalOpen(false);
  };

  const handleDeleteQuestion = (questionId: number) => {
    if (confirm('Are you sure you want to delete this question?')) {
      const newQuestions = questions.filter(q => q.id !== questionId);
      newQuestions.forEach((q, idx) => {
        q.sequence = idx + 1;
      });
      setQuestions(newQuestions);
      setHasChanges(true);
    }
  };

  const handleSave = () => {
    setSaveStatus('saving');
    saveMutation.mutate({ questions });
  };

  const isEditable = template?.source === 'custom' && isEditMode;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="skeleton h-8 w-64 mb-2" />
        <div className="skeleton h-5 w-96" />
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card p-4">
              <div className="skeleton h-6 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="h-12 w-12 text-rose-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-800 mb-2">Template Not Found</h3>
        <p className="text-slate-400 mb-4">The requested template could not be loaded.</p>
        <Link href="/risks/rcsa/templates" className="btn-primary">
          Back to Templates
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/risks/rcsa/templates" className="text-slate-400 hover:text-slate-900">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-800">{template.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${template.source === 'system' ? 'bg-blue-500/20 text-blue-400' : 'bg-primary-500/20 text-primary-600'}`}>
                {template.source}
              </span>
            </div>
            <p className="text-slate-400 mt-1">{template.description}</p>
          </div>
          <div className="flex items-center gap-3">
            {hasChanges && (
              <span className="text-amber-400 text-sm flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                Unsaved changes
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-emerald-400 text-sm flex items-center gap-1">
                <CheckCircle className="h-4 w-4" />
                Saved
              </span>
            )}
            {isEditable && (
              <button
                onClick={handleSave}
                disabled={!hasChanges || saveMutation.isPending}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            )}
            {template.source === 'custom' && !isEditMode && (
              <Link
                href={`/risks/rcsa/templates/${templateId}?edit=true`}
                className="btn-secondary flex items-center gap-2"
              >
                <Edit2 className="h-4 w-4" />
                Edit Template
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Category</p>
            <p className="text-slate-800 font-medium">{template.category}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Framework Type</p>
            <p className="text-slate-800 font-medium">{template.framework_type}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Questions</p>
            <p className="text-slate-800 font-medium">{questions.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-slate-400 text-sm">Last Updated</p>
            <p className="text-slate-800 font-medium">{new Date(template.updated_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-slate-800 flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary-400" />
            Questions ({questions.length})
          </h3>
          {isEditable && (
            <button
              onClick={() => {
                setEditingQuestion(null);
                setIsQuestionModalOpen(true);
              }}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Question
            </button>
          )}
        </div>

        <div className="space-y-3">
          {questions.map((question, index) => {
            const isExpanded = expandedQuestionId === question.id;
            return (
              <div
                key={question.id}
                draggable={isEditable}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`card p-4 ${isEditable ? 'cursor-move' : 'cursor-pointer'} ${draggedIndex === index ? 'opacity-50' : ''} hover:border-primary-500/30 transition-all`}
              >
                <div 
                  className="flex items-start gap-4"
                  onClick={() => !isEditable && setExpandedQuestionId(isExpanded ? null : question.id)}
                >
                  {isEditable && (
                    <div className="text-slate-500 mt-1">
                      <GripVertical className="h-5 w-5" />
                    </div>
                  )}
                  <div className="text-slate-400 font-medium w-8">{question.sequence || question.question_order || index + 1}.</div>
                  <div className="flex-1">
                    <p className="text-slate-800 mb-2">{question.question_text}</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[question.question_type]?.bg} ${TYPE_COLORS[question.question_type]?.text}`}>
                        {QUESTION_TYPES.find(t => t.value === question.question_type)?.label || question.question_type}
                      </span>
                      {(question.category || question.section) && (
                        <span className="text-xs text-slate-500">{question.category || question.section}</span>
                      )}
                      {question.is_required && (
                        <span className="text-xs text-rose-400">Required</span>
                      )}
                      {question.question_type === 'multiple_choice' && question.options && (
                        <span className="text-xs text-slate-500">
                          {question.options.length} options
                        </span>
                      )}
                      {!isEditable && (
                        <span className="text-xs text-primary-400 ml-auto">
                          {isExpanded ? <ChevronUp className="h-4 w-4 inline" /> : <ChevronDown className="h-4 w-4 inline" />}
                          {isExpanded ? ' Collapse' : ' Click to expand'}
                        </span>
                      )}
                    </div>
                  </div>
                  {isEditable && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingQuestion(question);
                          setIsQuestionModalOpen(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200 rounded"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteQuestion(question.id);
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/20 rounded"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Expanded Details */}
                {isExpanded && !isEditable && (
                  <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                    {/* Risk Category */}
                    {question.risk_category && (
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Risk Category</p>
                        <p className="text-slate-800">{question.risk_category}</p>
                      </div>
                    )}
                    
                    {/* Control Objective */}
                    {question.control_objective && (
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Control Objective</p>
                        <p className="text-slate-800">{question.control_objective}</p>
                      </div>
                    )}
                    
                    {/* Guidance */}
                    {(question.guidance || question.guidance_text) && (
                      <div>
                        <p className="text-sm text-slate-400 mb-1">Guidance</p>
                        <p className="text-slate-800 bg-slate-200/50 p-3 rounded-lg text-sm">{question.guidance || question.guidance_text}</p>
                      </div>
                    )}
                    
                    {/* Multiple Choice Options */}
                    {question.question_type === 'multiple_choice' && question.options && question.options.length > 0 && (
                      <div>
                        <p className="text-sm text-slate-400 mb-2">Available Options</p>
                        <div className="flex flex-wrap gap-2">
                          {question.options.map((opt, i) => (
                            <span key={i} className="px-3 py-1 bg-slate-200 text-slate-800 rounded-lg text-sm">
                              {opt}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Rating Scale Info */}
                    {question.question_type === 'risk_rating' && (
                      <div>
                        <p className="text-sm text-slate-400 mb-2">Risk Rating Scale</p>
                        <div className="flex gap-2">
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <div key={rating} className={`px-3 py-2 rounded-lg text-center text-sm ${
                              rating <= 2 ? 'bg-emerald-500/20 text-emerald-400' :
                              rating <= 3 ? 'bg-amber-500/20 text-amber-400' :
                              'bg-rose-500/20 text-rose-400'
                            }`}>
                              {rating}
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">1 = Low Risk, 5 = Critical Risk</p>
                      </div>
                    )}
                    
                    {/* Control Rating Info */}
                    {question.question_type === 'control_rating' && (
                      <div>
                        <p className="text-sm text-slate-400 mb-2">Control Effectiveness Scale</p>
                        <div className="flex gap-2">
                          {['Effective', 'Partially Effective', 'Ineffective', 'Not Applicable'].map((rating) => (
                            <span key={rating} className={`px-3 py-1 rounded-lg text-sm ${
                              rating === 'Effective' ? 'bg-emerald-500/20 text-emerald-400' :
                              rating === 'Partially Effective' ? 'bg-amber-500/20 text-amber-400' :
                              rating === 'Ineffective' ? 'bg-rose-500/20 text-rose-400' :
                              'bg-slate-500/20 text-slate-400'
                            }`}>
                              {rating}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* AI Suggestion Badge */}
                    {question.ai_suggestion_enabled && (
                      <div className="flex items-center gap-2 text-primary-400">
                        <Star className="h-4 w-4" />
                        <span className="text-sm">AI suggestions enabled for this question</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {questions.length === 0 && (
          <div className="text-center py-12">
            <HelpCircle className="h-12 w-12 text-slate-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-800 mb-2">No Questions Yet</h3>
            <p className="text-slate-400 mb-4">Add questions to build your RCSA template</p>
            {isEditable && (
              <button
                onClick={() => {
                  setEditingQuestion(null);
                  setIsQuestionModalOpen(true);
                }}
                className="btn-primary"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add First Question
              </button>
            )}
          </div>
        )}
      </div>

      {isQuestionModalOpen && (
        <QuestionModal
          question={editingQuestion}
          onClose={() => {
            setIsQuestionModalOpen(false);
            setEditingQuestion(null);
          }}
          onSave={(data) => {
            if (editingQuestion) {
              handleUpdateQuestion(data);
            } else {
              handleAddQuestion(data);
            }
          }}
        />
      )}
    </div>
  );
}

function QuestionModal({
  question,
  onClose,
  onSave,
}: {
  question: Question | null;
  onClose: () => void;
  onSave: (data: Partial<Question>) => void;
}) {
  const [questionType, setQuestionType] = useState(question?.question_type || 'text');
  const [options, setOptions] = useState<string[]>(question?.options || ['']);

  const handleAddOption = () => {
    setOptions([...options, '']);
  };

  const handleRemoveOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index));
  };

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto py-8">
      <div className="bg-white rounded-xl p-6 w-full max-w-lg border border-slate-200 mx-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-slate-800">
            {question ? 'Edit Question' : 'Add Question'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            onSave({
              question_text: formData.get('question_text') as string,
              question_type: questionType as Question['question_type'],
              category: formData.get('category') as string,
              is_required: formData.get('is_required') === 'on',
              guidance: formData.get('guidance') as string,
              options: questionType === 'multiple_choice' ? options.filter(o => o.trim()) : undefined,
            });
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Question Text</label>
              <textarea
                name="question_text"
                defaultValue={question?.question_text}
                className="input w-full"
                rows={3}
                required
                placeholder="Enter your question"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">Question Type</label>
              <div className="grid grid-cols-2 gap-2">
                {QUESTION_TYPES.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setQuestionType(type.value)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      questionType === type.value
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <type.icon className={`h-4 w-4 ${questionType === type.value ? 'text-primary-400' : 'text-slate-400'}`} />
                      <span className={`text-sm font-medium ${questionType === type.value ? 'text-slate-800' : 'text-slate-600'}`}>
                        {type.label}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{type.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {questionType === 'multiple_choice' && (
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-2">Options</label>
                <div className="space-y-2">
                  {options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={option}
                        onChange={(e) => handleOptionChange(index, e.target.value)}
                        className="input flex-1"
                        placeholder={`Option ${index + 1}`}
                      />
                      {options.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveOption(index)}
                          className="p-2 text-slate-400 hover:text-rose-400"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddOption}
                    className="text-primary-400 hover:text-primary-300 text-sm flex items-center gap-1"
                  >
                    <Plus className="h-4 w-4" />
                    Add Option
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Category</label>
              <input
                type="text"
                name="category"
                defaultValue={question?.category}
                className="input w-full"
                placeholder="e.g., Risk Assessment, Control Testing"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Guidance (Optional)</label>
              <textarea
                name="guidance"
                defaultValue={question?.guidance}
                className="input w-full"
                rows={2}
                placeholder="Help text for assessors"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                name="is_required"
                id="is_required"
                defaultChecked={question?.is_required ?? true}
                className="rounded border-slate-300 bg-slate-200 text-primary-500 focus:ring-primary-500"
              />
              <label htmlFor="is_required" className="text-sm text-slate-600">
                Required question
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {question ? 'Update Question' : 'Add Question'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
