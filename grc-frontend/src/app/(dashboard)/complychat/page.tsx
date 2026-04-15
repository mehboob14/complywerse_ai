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
  RefreshCw,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Database
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

const SUGGESTED_PROMPTS = [
  {
    icon: Shield,
    title: 'Audit Universe',
    prompt: 'Show the audit universe and how many auditable entities are in scope',
  },
  {
    icon: FileText,
    title: 'Audit Findings',
    prompt: 'List open audit findings by severity and engagement',
  },
  {
    icon: BarChart3,
    title: 'Audit Capacity',
    prompt: 'Show auditor utilization and capacity allocation for this quarter',
  },
  {
    icon: AlertTriangle,
    title: 'QAIP Reviews',
    prompt: 'What QAIP reviews are pending and their current status?',
  },
];

export default function ComplyChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: '1',
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    }
  ]);
  const [activeConversationId, setActiveConversationId] = useState('1');
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [showSources, setShowSources] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = conversations.find(c => c.id === activeConversationId);
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

  const createNewConversation = () => {
    const newConv: Conversation = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    };
    setConversations([...conversations, newConv]);
    setActiveConversationId(newConv.id);
  };

  const deleteConversation = (id: string) => {
    const filtered = conversations.filter(c => c.id !== id);
    setConversations(filtered.length > 0 ? filtered : [{
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
      createdAt: new Date(),
    }]);
    if (activeConversationId === id && filtered.length > 0) {
      setActiveConversationId(filtered[0].id);
    }
  };

  const sendMessage = async (
    content: string,
    offset: number = 0,
    messageId?: string,
    questionOverride?: string
  ) => {
    const questionText = questionOverride !== undefined ? questionOverride : content;
    if (!questionText.trim() || isLoading) return;

    // If this is a Load More request
    if (messageId !== undefined) {
      setLoadingMore(messageId);
    } else {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: questionText.trim(),
        timestamp: new Date(),
      };

      // Update conversation with user message
      setConversations(prev => prev.map(conv => {
        if (conv.id === activeConversationId) {
          const updatedMessages = [...conv.messages, userMessage];
          return {
            ...conv,
            messages: updatedMessages,
            title: conv.messages.length === 0 ? questionText.trim().slice(0, 50) : conv.title,
          };
        }
        return conv;
      }));

      setInputMessage('');
      setIsLoading(true);

      // Add loading message
      const loadingMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isLoading: true,
      };

      setConversations(prev => prev.map(conv => {
        if (conv.id === activeConversationId) {
          return { ...conv, messages: [...conv.messages, loadingMessage] };
        }
        return conv;
      }));
    }

    try {
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
          message: questionText.trim(),
          framework: null,
          include_sources: true,
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
          if (conv.id === activeConversationId) {
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
          if (conv.id === activeConversationId) {
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
        content: '❌ Sorry, I encountered an error connecting to the backend. Please ensure the server is running and try again.',
        timestamp: new Date(),
      };

      setConversations(prev => prev.map(conv => {
        if (conv.id === activeConversationId) {
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
      <div className="hidden lg:flex lg:w-56 flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black">Conversations</h2>
          <button
            onClick={createNewConversation}
            className="p-1.5 rounded-lg text-black hover:text-black hover:bg-white transition-colors"
            title="New conversation"
          >
            <Plus size={16} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveConversationId(conv.id)}
              className={clsx(
                'w-full text-left px-3 py-2.5 rounded-lg transition-all group',
                'hover:bg-white/80',
                activeConversationId === conv.id
                  ? 'bg-primary-600/15 border-l-2 border-primary-500 text-black'
                  : 'text-black border-l-2 border-transparent'
              )}
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">
                    {conv.title}
                  </p>
                  <p className="text-xs text-slate-800 mt-0.5">
                    {conv.messages.length} messages
                  </p>
                </div>
                {conversations.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-100 transition-all"
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
                                <p className="mb-2 last:mb-0 text-slate-700 leading-relaxed">{children}</p>
                              ),
                              ul: ({ children }) => (
                                <ul className="list-disc list-inside mb-2 space-y-1 text-slate-700">{children}</ul>
                              ),
                              ol: ({ children }) => (
                                <ol className="list-decimal list-inside mb-2 space-y-1 text-slate-700">{children}</ol>
                              ),
                              li: ({ children }) => (
                                <li className="text-slate-700">{children}</li>
                              ),
                              strong: ({ children }) => (
                                <strong className="font-semibold text-black">{children}</strong>
                              ),
                              code: ({ children }) => (
                                <code className="px-1.5 py-0.5 rounded bg-slate-100 text-black text-xs font-mono">
                                  {children}
                                </code>
                              ),
                              pre: ({ children }) => (
                                <pre className="my-2 overflow-x-auto rounded-lg bg-slate-100 p-2.5 text-[13px]">
                                  {children}
                                </pre>
                              ),
                              h1: ({ children }) => (
                                <h1 className="text-lg font-bold text-black mb-2">{children}</h1>
                              ),
                              h2: ({ children }) => (
                                <h2 className="text-base font-bold text-black mb-2">{children}</h2>
                              ),
                              h3: ({ children }) => (
                                <h3 className="text-sm font-bold text-black mb-1">{children}</h3>
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
          <form onSubmit={handleSubmit} className="relative">
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about controls, evidence, compliance requirements..."
              rows={1}
              className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 pr-11 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 scrollbar-thin"
              style={{ minHeight: '42px', maxHeight: '132px' }}
            />
            <button
              type="submit"
              disabled={!inputMessage.trim() || isLoading}
              className={clsx(
                'absolute bottom-1.5 right-1.5 rounded-lg p-2 transition-all',
                inputMessage.trim() && !isLoading
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
          </form>
          <p className="text-xs text-slate-800 mt-2 text-center">
            ComplyChat can make mistakes. Verify important information with official documentation.
          </p>
        </div>
      </div>
    </div>
  );
}
