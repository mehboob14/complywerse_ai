'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Send,
  Loader2,
  MessageSquare,
  Sparkles,
  FileText,
  Shield,
  BarChart3,
  AlertTriangle,
  Bot,
  User,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Database,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getTenantSlug } from '@/lib/api';

interface Source {
  rank: number;
  entity_type: string;
  entity_id?: string;
  framework_code: string;
  control_code: string | null;
  control_name: string | null;
  relevance_score: number;
  snippet: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  sources?: Source[];
  hasMore?: boolean;
  totalCount?: number;
  currentOffset?: number;
  originalQuestion?: string;
}

interface UploadedChatFile {
  id: string;
  filename: string;
  size: number;
  content_type?: string;
  uploaded_at?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  attachments?: UploadedChatFile[];
}

const CONVERSATION_STORAGE_KEY = 'complychat.conversations.v2';
const ACTIVE_CHAT_STORAGE_KEY = 'complychat.activeConversation.v2';

const createConversation = (): Conversation => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: 'New Conversation',
  messages: [],
  createdAt: new Date(),
  attachments: [],
});

const loadStoredConversations = (): Conversation[] => {
  if (typeof window === 'undefined') {
    return [createConversation()];
  }

  try {
    const raw = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) {
      return [createConversation()];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createConversation()];
    }

    return parsed.map((conversation: Partial<Conversation> & { messages?: Array<Partial<Message>> }) => ({
      id: conversation.id || createConversation().id,
      title: conversation.title || 'New Conversation',
      createdAt: new Date(conversation.createdAt || Date.now()),
      attachments: Array.isArray(conversation.attachments) ? conversation.attachments : [],
      messages: Array.isArray(conversation.messages)
        ? conversation.messages.map((message) => ({
            id: message.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content || '',
            timestamp: new Date(message.timestamp || Date.now()),
            isLoading: Boolean(message.isLoading),
            sources: message.sources as Source[] | undefined,
            hasMore: message.hasMore,
            totalCount: message.totalCount,
            currentOffset: message.currentOffset,
            originalQuestion: message.originalQuestion,
          }))
        : [],
    }));
  } catch (error) {
    console.error('Failed to load stored conversations:', error);
    return [createConversation()];
  }
};

const SUGGESTED_PROMPTS = [
  {
    icon: Shield,
    title: 'Framework Progress',
    prompt: 'Show framework progress overview and any active compliance journeys',
  },
  {
    icon: FileText,
    title: 'Evidence Gaps',
    prompt: 'List controls with missing or weak evidence that need attention',
  },
  {
    icon: BarChart3,
    title: 'Risk Summary',
    prompt: 'Show the highest priority risks and their current treatment status',
  },
  {
    icon: AlertTriangle,
    title: 'Open Vulnerabilities',
    prompt: 'What critical vulnerabilities or remediation actions are still open?',
  },
];

export default function ComplyChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadStoredConversations());
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) || '';
  });
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [showSources, setShowSources] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeConversation = conversations.find(c => c.id === activeConversationId) || conversations[0];
  const messages = useMemo(() => activeConversation?.messages || [], [activeConversation]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [inputMessage]);

  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
      return;
    }

    if (activeConversationId && !conversations.some((conversation) => conversation.id === activeConversationId) && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (typeof window === 'undefined' || conversations.length === 0) return;
    window.localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(conversations));
    if (activeConversationId) {
      window.localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeConversationId);
    }
  }, [conversations, activeConversationId]);

  useEffect(() => {
    setSelectedFiles([]);
  }, [activeConversationId]);

  const createNewConversation = () => {
    const newConversation = createConversation();
    setConversations((prev) => [...prev, newConversation]);
    setActiveConversationId(newConversation.id);
    setInputMessage('');
    setShowSources(null);
  };

  const deleteConversation = async (id: string) => {
    try {
      await fetch(`/api/ai/complychat/history/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
        credentials: 'include',
      });
    } catch (error) {
      console.warn('Failed to clear server-side conversation history:', error);
    }

    const filtered = conversations.filter((conversation) => conversation.id !== id);
    const nextConversations = filtered.length > 0 ? filtered : [createConversation()];
    setConversations(nextConversations);
    if (activeConversationId === id) {
      setActiveConversationId(nextConversations[0].id);
    }
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(event.target.files || []);
    if (newFiles.length === 0) return;

    setSelectedFiles((prev) => [...prev, ...newFiles]);
    event.target.value = '';
  };

  const removePendingFile = (indexToRemove: number) => {
    setSelectedFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const uploadFilesForConversation = async (conversationId: string, filesToUpload: File[]) => {
    if (filesToUpload.length === 0) return [] as UploadedChatFile[];

    const formData = new FormData();
    formData.append('session_id', conversationId);
    filesToUpload.forEach((file) => formData.append('files', file));

    const response = await fetch('/api/ai/complychat/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        ...(getTenantSlug() ? { 'X-Tenant-Slug': getTenantSlug()! } : {}),
      },
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    const data = await response.json();
    const uploadedFiles = Array.isArray(data.uploaded_files) ? (data.uploaded_files as UploadedChatFile[]) : [];

    setConversations((prev) => prev.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const existingAttachments = conversation.attachments || [];
      return {
        ...conversation,
        attachments: [...existingAttachments, ...uploadedFiles],
      };
    }));

    setSelectedFiles([]);
    return uploadedFiles;
  };

  const sendMessage = async (
    content: string,
    offset: number = 0,
    messageId?: string,
    questionOverride?: string
  ) => {
    const currentConversationId = activeConversationId || activeConversation?.id || '';
    const currentConversation = conversations.find((conversation) => conversation.id === currentConversationId);
    const isLoadMoreRequest = messageId !== undefined;
    const baseQuestion = questionOverride !== undefined ? questionOverride : content;

    let questionText = baseQuestion.trim();
    if (!questionText && !isLoadMoreRequest && selectedFiles.length > 0) {
      questionText = 'Please analyze the uploaded files and summarize the key GRC-relevant information.';
    }

    if ((!questionText && selectedFiles.length === 0) || !currentConversationId || isLoading) return;

    const historyPayload = (currentConversation?.messages || [])
      .filter((message) => !message.isLoading)
      .slice(-10)
      .map((message) => ({ role: message.role, content: message.content }));

    try {
      let uploadedFiles: UploadedChatFile[] = [];

      if (isLoadMoreRequest) {
        setLoadingMore(messageId);
      } else {
        if (selectedFiles.length > 0) {
          uploadedFiles = await uploadFilesForConversation(currentConversationId, selectedFiles);
        }

        const visibleQuestion = uploadedFiles.length > 0
          ? `Uploaded files: ${uploadedFiles.map((file) => file.filename).join(', ')}\n\n${questionText}`
          : questionText;

        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          content: visibleQuestion,
          timestamp: new Date(),
        };

        setConversations((prev) => prev.map((conversation) => {
          if (conversation.id === currentConversationId) {
            const updatedMessages = [...conversation.messages, userMessage];
            return {
              ...conversation,
              messages: updatedMessages,
              title: conversation.messages.length === 0 ? questionText.slice(0, 50) : conversation.title,
            };
          }
          return conversation;
        }));

        setInputMessage('');
        setIsLoading(true);

        const loadingMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isLoading: true,
        };

        setConversations((prev) => prev.map((conversation) => {
          if (conversation.id === currentConversationId) {
            return { ...conversation, messages: [...conversation.messages, loadingMessage] };
          }
          return conversation;
        }));
      }

      // Call actual backend API
      const response = await fetch('/api/ai/complychat/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          message: questionText,
          framework: null,
          include_sources: true,
          session_id: currentConversationId,
          history: historyPayload,
          limit: 10,
          offset: offset,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (messageId !== undefined) {
        // Append to existing message (Load More)
        setConversations(prev => prev.map(conv => {
          if (conv.id === currentConversationId) {
            return {
              ...conv,
              messages: conv.messages.map(msg => {
                if (msg.id === messageId) {
                  return {
                    ...msg,
                    content: msg.content + '\n\n' + data.answer,
                    hasMore: data.has_more,
                    totalCount: data.total_count,
                    currentOffset: (data.current_offset || offset) + 10,
                  };
                }
                return msg;
              })
            };
          }
          return conv;
        }));
        setLoadingMore(null);
      } else {
        // New assistant message
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.answer || 'No response received from the server.',
          timestamp: new Date(),
          sources: data.sources,
          hasMore: data.has_more,
          totalCount: data.total_count,
          currentOffset: (data.current_offset || offset) + 10,
          originalQuestion: questionText,
        };

        setConversations(prev => prev.map(conv => {
          if (conv.id === currentConversationId) {
            const filtered = conv.messages.filter(m => !m.isLoading);
            return { ...conv, messages: [...filtered, aiResponse] };
          }
          return conv;
        }));

        setIsLoading(false);
      }
    } catch (error) {
      console.error('API Error:', error);
      
      const errorResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry for the inconvenience, Something went wrong on our end. Please try again Later.',
        timestamp: new Date(),
      };

      setConversations(prev => prev.map(conv => {
        if (conv.id === currentConversationId) {
          const filtered = conv.messages.filter(m => !m.isLoading);
          return { ...conv, messages: [...filtered, errorResponse] };
        }
        return conv;
      }));

      setIsLoading(false);
      setLoadingMore(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    setInputMessage(prompt);
    setTimeout(() => sendMessage(prompt), 100);
  };

  return (
    <div className="flex h-[calc(100vh-4.75rem)] gap-3">
      {/* Conversations Sidebar */}
      <div
        className={clsx(
          'hidden lg:flex flex-col gap-2.5 transition-all duration-200',
          isSidebarCollapsed ? 'lg:w-16' : 'lg:w-56'
        )}
      >
        <div className="flex items-center justify-between">
          {!isSidebarCollapsed && <h2 className="text-sm font-semibold text-black">Conversations</h2>}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className="p-1.5 rounded-lg text-black hover:bg-white transition-colors"
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button
              onClick={createNewConversation}
              className="p-1.5 rounded-lg text-black hover:text-black hover:bg-white transition-colors"
              title="New conversation"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConversationId(conv.id)}
              title={conv.title}
              className={clsx(
                'w-full text-left px-3 py-2.5 rounded-lg transition-all group',
                'hover:bg-white/80',
                activeConversation?.id === conv.id
                  ? 'bg-primary-600/15 border-l-2 border-primary-500 text-black'
                  : 'text-black border-l-2 border-transparent'
              )}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex-1 min-w-0">
                  {isSidebarCollapsed ? (
                    <div className="flex justify-center">
                      <MessageSquare size={16} className="text-black" />
                    </div>
                  ) : (
                    <>
                      <p className="text-[13px] font-medium truncate">
                        {conv.title}
                      </p>
                      <p className="text-xs text-slate-800 mt-0.5">
                        {conv.messages.length} messages
                      </p>
                    </>
                  )}
                </div>
                {conversations.length > 1 && !isSidebarCollapsed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 transition-all"
                    title="Delete chat"
                  >
                    <Trash2 size={12} className="text-slate-800 hover:text-red-400" />
                  </button>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/30">
        {/* Chat Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-primary-600/20 p-1.5">
              <Sparkles className="h-4 w-4 text-primary-600" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">ComplyChat AI</h1>
              <p className="text-xs text-slate-600">Your GRC Compliance Assistant</p>
            </div>
          </div>
          <button
            onClick={createNewConversation}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 scrollbar-thin">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="mb-4 rounded-full bg-primary-600/10 p-3">
                <MessageSquare className="h-10 w-10 text-primary-600" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-slate-900">
                Welcome to ComplyChat
              </h2>
              <p className="mb-6 max-w-md text-sm text-slate-600">
                Your AI-powered GRC compliance assistant. Ask me anything about controls,
                evidence, frameworks, or compliance requirements.
              </p>

              <div className="grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSuggestedPrompt(prompt.prompt)}
                    className="group flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white/50 p-3 text-left transition-all hover:border-primary-600/50 hover:bg-slate-100/50"
                  >
                    <div className="rounded-lg bg-primary-600/10 p-1.5 transition-colors group-hover:bg-primary-600/20">
                      <prompt.icon className="h-4 w-4 text-primary-600" />
                    </div>
                    <div className="flex-1">
                      <p className="mb-1 text-sm font-medium text-slate-900">
                        {prompt.title}
                      </p>
                      <p className="text-xs text-slate-600">
                        {prompt.prompt}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={clsx(
                    'flex gap-3 animate-fade-in',
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                    </div>
                  )}

                  <div
                    className={clsx(
                      'flex flex-col max-w-[90%] sm:max-w-[85%]',
                      message.role === 'user' ? 'items-end' : 'items-start'
                    )}
                  >
                    <div
                      className={clsx(
                        'rounded-2xl px-3.5 py-2.5 shadow-md',
                        message.role === 'user'
                          ? 'bg-primary-600 text-white rounded-tr-sm'
                          : 'bg-white text-black rounded-tl-sm border border-slate-200'
                      )}
                    >
                      {message.isLoading ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">Thinking...</span>
                        </div>
                      ) : message.role === 'assistant' ? (
                        <div className="prose prose-sm max-w-none text-black">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({ children }) => (
                                <div className="overflow-x-auto my-4 rounded-lg border border-slate-200 shadow-sm">
                                  <table className="min-w-full divide-y divide-slate-200 text-[13px]">
                                    {children}
                                  </table>
                                </div>
                              ),
                              thead: ({ children }) => (
                                <thead className="bg-gradient-to-r from-blue-600 to-blue-700">
                                  {children}
                                </thead>
                              ),
                              th: ({ children }) => (
                                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-black">
                                  {children}
                                </th>
                              ),
                              tbody: ({ children }) => (
                                <tbody className="bg-white divide-y divide-slate-100">
                                  {children}
                                </tbody>
                              ),
                              tr: ({ children }) => (
                                <tr className="hover:bg-slate-50 transition-colors">
                                  {children}
                                </tr>
                              ),
                              td: ({ children }) => (
                                <td className="max-w-xs px-3 py-2.5 align-top text-slate-700">
                                  <div className="line-clamp-2 hover:line-clamp-none transition-all cursor-pointer" title={String(children)}>
                                    {children}
                                  </div>
                                </td>
                              ),
                              p: ({ children }) => (
                                <p className="mb-2 last:mb-0 text-[13px] text-slate-700 leading-relaxed">{children}</p>
                              ),
                              ul: ({ children }) => (
                                <ul className="list-disc pl-4 mb-3 space-y-1 text-[13px] text-slate-700">{children}</ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="list-decimal pl-4 mb-3 space-y-1.5 text-[13px] text-slate-700">{children}</ol>
                              ),
                              li: ({ children }) => (
                                <li className="text-[13px] text-slate-700 leading-relaxed">{children}</li>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold text-slate-900">{children}</strong>
                              ),
                              em: ({ children }) => (
                                <em className="text-slate-500 not-italic text-[12px]">{children}</em>
                              ),
                              code: ({ children }) => (
                                <code className="px-1.5 py-0.5 rounded bg-slate-100 text-blue-700 text-xs font-mono">
                                  {children}
                                </code>
                              ),
                              pre: ({ children }) => (
                                <pre className="my-2 overflow-x-auto rounded-lg bg-slate-100 p-2.5 text-[13px]">
                                  {children}
                                </pre>
                              ),
                              blockquote: ({ children }) => (
                                <blockquote className="my-2 pl-3 border-l-4 border-blue-400 bg-blue-50 rounded-r-md py-1.5 text-slate-700 text-[13px]">
                                  {children}
                                </blockquote>
                              ),
                              h1: ({ children }) => (
                                <h1 className="text-[15px] font-bold text-slate-900 mt-4 mb-2 pb-1 border-b border-slate-200">{children}</h1>
                              ),
                              h2: ({ children }) => (
                                <h2 className="text-[14px] font-semibold text-blue-700 mt-3 mb-1.5 flex items-center gap-1.5">
                                  <span className="inline-block w-1 h-3.5 rounded-full bg-blue-500 flex-shrink-0" />
                                  {children}
                                </h2>
                              ),
                              h3: ({ children }) => (
                                <h3 className="text-[13px] font-semibold text-slate-800 mt-2 mb-1">{children}</h3>
                              ),
                              hr: () => (
                                <hr className="my-3 border-slate-200" />
                              ),
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>

                          {/* Load More Button */}
                          {message.hasMore && (
                            <div className="mt-4 pt-3 border-t border-slate-200">
                              <button
                                onClick={() => sendMessage('', message.currentOffset || 10, message.id, message.originalQuestion)}
                                disabled={loadingMore === message.id}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {loadingMore === message.id ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Loading more...</span>
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="h-4 w-4" />
                                    <span>Load More Results</span>
                                    {message.totalCount && (
                                      <span className="text-xs text-slate-800 ml-1">
                                        (showing {message.currentOffset || 10} of {message.totalCount})
                                      </span>
                                    )}
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {/* Sources Section */}
                          {message.sources && message.sources.length > 0 && (
                            <div className="mt-4 pt-3 border-t border-slate-200">
                              <button
                                onClick={() => setShowSources(showSources === message.id ? null : message.id)}
                                className="flex items-center gap-2 text-sm font-medium text-black hover:text-black transition-colors"
                              >
                                {showSources === message.id ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                                <Database className="h-4 w-4" />
                                <span>View Sources ({message.sources.length})</span>
                              </button>
                              
                              {showSources === message.id && (
                                <div className="mt-3 space-y-2">
                                  {message.sources.map((source, idx) => (
                                    <div
                                      key={idx}
                                      className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs"
                                    >
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                                          {source.framework_code}
                                        </span>
                                        <span className="font-medium text-black">
                                          {source.control_code}
                                        </span>
                                        <span className="text-slate-800">•</span>
                                        <span className="text-black">{source.entity_type}</span>
                                        {source.relevance_score && (
                                          <span className="ml-auto text-slate-800">
                                            Score: {(source.relevance_score * 100).toFixed(0)}%
                                          </span>
                                        )}
                                      </div>
                                      {source.control_name && (
                                        <p className="text-slate-700 line-clamp-2">{source.control_name}</p>
                                      )}
                                      {source.snippet && (
                                        <p className="text-slate-800 mt-1 line-clamp-2 italic">{source.snippet}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p
                          className={clsx(
                            'text-sm leading-relaxed whitespace-pre-wrap',
                            message.role === 'user' ? 'text-white' : 'text-black'
                          )}
                        >
                          {message.content}
                        </p>
                      )}
                    </div>
                    <span
                      className={clsx(
                        'text-xs mt-1 px-1',
                        message.role === 'user' ? 'text-white/80' : 'text-slate-800'
                      )}
                    >
                      {message.timestamp.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {message.role === 'user' && (
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                        <User className="h-4 w-4 text-black" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t border-slate-200 bg-white/50 p-3">
          {(activeConversation?.attachments?.length || 0) > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {activeConversation?.attachments?.map((file) => (
                <span
                  key={`${file.id}-${file.filename}`}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                >
                  <Paperclip className="h-3 w-3" />
                  <span className="max-w-[180px] truncate">{file.filename}</span>
                </span>
              ))}
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {selectedFiles.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
                >
                  <Paperclip className="h-3 w-3" />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removePendingFile(index)}
                    className="rounded-full p-0.5 hover:bg-blue-100"
                    title="Remove file"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="relative">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelection}
            />

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border border-slate-300 bg-white p-2.5 text-slate-700 transition-colors hover:bg-slate-100"
                title="Attach files"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about controls, evidence, risks, or upload files for analysis..."
                  rows={1}
                  className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-11 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 scrollbar-thin"
                  style={{ minHeight: '42px', maxHeight: '132px' }}
                />
                <button
                  type="submit"
                  disabled={(!inputMessage.trim() && selectedFiles.length === 0) || isLoading}
                  className={clsx(
                    'absolute bottom-1.5 right-1.5 rounded-lg p-2 transition-all',
                    (inputMessage.trim() || selectedFiles.length > 0) && !isLoading
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'bg-slate-100 text-slate-800 cursor-not-allowed'
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </form>
          <p className="text-xs text-slate-800 mt-2 text-center">
            ComplyChat can make mistakes. Verify important information with official documentation. Chats stay here until you delete them.
          </p>
        </div>
      </div>
    </div>
  );
}
