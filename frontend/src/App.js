import React, { useState, useEffect, useRef, memo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Container,
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Divider,
  AppBar,
  Toolbar,
  IconButton,
  Avatar,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tab,
  Tabs,
  Grid,
  Alert,
  Snackbar,
  Link,
  Chip,
  Fade,
  Zoom,
  Badge,
  useTheme,
  useMediaQuery
} from '@mui/material';
import {
  Send as SendIcon,
  ExitToApp as LogoutIcon,
  Google as GoogleIcon,
  GitHub as GitHubIcon,
  Facebook as FacebookIcon,
  Email as EmailIcon,
  Lock as LockIcon,
  ArrowBack as ArrowBackIcon,
  SupportAgent as SupportIcon,
  Computer as ComputerIcon,
  AttachMoney as BillingIcon
} from '@mui/icons-material';
import './App.css';

// Initialize Supabase client - replace with your actual keys
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-supabase-url.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-supabase-anon-key';
const supabase = createClient(supabaseUrl, supabaseKey);

// WebSocket configuration
const WS_URL = process.env.REACT_APP_SOCKET_URL || 'ws://localhost:3001';
const RECONNECT_INTERVAL = 3000; // 3 seconds
const MAX_RECONNECT_ATTEMPTS = 10;
const STREAMING_SPEED = 50; // Milliseconds per character

// Memoized AssistantHeader: only re-renders when assistant or transferInProgress change
const AssistantHeader = memo(function AssistantHeader({ assistant, transferInProgress, config, isMobile }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <Zoom in={!transferInProgress} style={{ transitionDelay: transferInProgress ? '300ms' : '0ms' }}>
        <Paper
          elevation={3}
          sx={{
            backgroundColor: config.color,
            color: 'white',
            padding: 2,
            display: 'flex',
            alignItems: 'center',
            borderRadius: '0 0 12px 12px',
            transition: 'all 0.4s ease',
          }}
        >
          <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', mr: 2 }}>
            {config.icon}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">{config.name}</Typography>
            {!isMobile && (
              <Typography variant="caption">{config.description}</Typography>
            )}
          </Box>
        </Paper>
      </Zoom>
    </Box>
  );
}, (prev, next) =>
  prev.assistant === next.assistant &&
  prev.transferInProgress === next.transferInProgress
);

function App() {
  // State variables
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [ws, setWs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [authView, setAuthView] = useState('login');
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [typingIndicator, setTypingIndicator] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [currentAssistant, setCurrentAssistant] = useState('ToGeneralAssistant'); // UI's current assistant
  const [transferInProgress, setTransferInProgress] = useState(false);
  const [previousAssistant, setPreviousAssistant] = useState(null); // For animation: UI's assistant before transfer
  const [initialMessagesLoaded, setInitialMessagesLoaded] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const workerRef = useRef(null); // For the Web Worker

  // Ref to store the currentAssistant value from the PREVIOUS backend message that specified an assistant
  const prevBackendAssistantIdRef = useRef('ToGeneralAssistant');

  // Helper to get the normalized assistant value from backend response
  const getCurrentAssistant = (data) => data.currentAssistant || data.current_assistant || '';

  const clearAuthFields = () => {
    setAuthEmail('');
    setAuthPassword('');
    setConfirmPassword('');
  };

  const assistantConfig = {
    ToGeneralAssistant: {
      name: "General Assistant",
      color: "#3f51b5",
      icon: <SupportIcon />,
      description: "I can help with general inquiries about our products and services."
    },
    ToTechnicalAssistant: {
      name: "Technical Assistant",
      color: "#00796b",
      icon: <ComputerIcon />,
      description: "I specialize in technical support and troubleshooting."
    },
    ToBillingAssistant: {
      name: "Billing Assistant",
      color: "#5e35b1",
      icon: <BillingIcon />,
      description: "I can assist with billing, payments, and account inquiries."
    }
  };

  useEffect(() => {
    workerRef.current = new Worker(process.env.PUBLIC_URL + '/streamingWorker.js');
    workerRef.current.onmessage = (event) => {
      const { type, messageId, contentPart, fullText } = event.data;
      if (type === 'update') {
        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.id === messageId ? { ...msg, content: contentPart } : msg
          )
        );
      } else if (type === 'done') {
        setMessages(prevMessages =>
          prevMessages.map(msg =>
            msg.id === messageId ? { ...msg, content: fullText, streaming: false } : msg
          )
        );
      }
    };
    workerRef.current.onerror = (error) => {
      console.error("Streaming Worker Error:", error);
    };
    return () => {
      workerRef.current.terminate();
    };
  }, []);

  const streamMessageContent = (messageId, fullText) => {
    if (workerRef.current) {
      workerRef.current.postMessage({ messageId, fullText, speed: STREAMING_SPEED });
    }
  };

  useEffect(() => {
    if (user && user.id && !initialMessagesLoaded) {
      try {
        const storedMessages = localStorage.getItem(`chatMessages_${user.id}`);
        if (storedMessages) {
          const parsedMessages = JSON.parse(storedMessages);
          if (parsedMessages.length > 0) {
            setMessages(parsedMessages.map(msg => ({...msg, streaming: false})));
             // Restore last known assistant from messages
            const lastBotMessageWithAssistant = [...parsedMessages].reverse().find(m => m.sender === 'assistant' && m.assistantType && assistantConfig[m.assistantType]);
            if (lastBotMessageWithAssistant) {
                setCurrentAssistant(lastBotMessageWithAssistant.assistantType);
                prevBackendAssistantIdRef.current = lastBotMessageWithAssistant.assistantType;
            }
          }
        }
      } catch (e) {
        console.error("Failed to load messages from localStorage", e);
        localStorage.removeItem(`chatMessages_${user.id}`);
      }
      setInitialMessagesLoaded(true);
    }
  }, [user, initialMessagesLoaded]);

  useEffect(() => {
    if (user && user.id && initialMessagesLoaded && messages.length > 0) {
      const messagesToSave = messages.map(msg => {
        if (msg.streaming) {
          // Don't save 'streaming: true' to localStorage
          const { streaming, ...rest } = msg;
          return rest;
        }
        return msg;
      });
      try {
        localStorage.setItem(`chatMessages_${user.id}`, JSON.stringify(messagesToSave));
      } catch (e) {
        console.error("Failed to save messages to localStorage", e);
      }
    }
  }, [user, messages, initialMessagesLoaded]);

  const handleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    });
    if (error) throw error;
    setUser(data.user);
    setLoginDialogOpen(false);
    clearAuthFields();
  };

  const handleSignup = async () => {
    if (authPassword !== confirmPassword) {
      throw new Error('Passwords do not match');
    }
    const { data, error } = await supabase.auth.signUp({
      email: authEmail,
      password: authPassword,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    if (data.user && data.user.identities?.length === 0) {
      showSnackbar('Email already registered. Please log in.', 'warning');
      setAuthView('login');
    } else {
      showSnackbar('Check your email for the confirmation link!', 'info');
      setAuthView('login');
    }
    clearAuthFields();
  };

  const handleResetPassword = async () => {
    if (authPassword) { // This part is for when user is setting a new password after clicking link
      const { error } = await supabase.auth.updateUser({ password: authPassword });
      if (error) throw error;
      showSnackbar('Password updated successfully!', 'success');
      setAuthView('login');
      clearAuthFields();
    } else { // This part is for initiating the password reset
      const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
        redirectTo: window.location.origin, // Ensure this matches your Supabase redirect settings
      });
      if (error) throw error;
      showSnackbar('Password reset email sent!', 'success');
      setAuthView('login'); // Or keep them on a confirmation view
      clearAuthFields();
    }
  };

  const handleMagicLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email: authEmail,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    showSnackbar('Check your email for the magic link!', 'info');
    setAuthView('login');
    clearAuthFields();
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (authView === 'login') await handleLogin();
      else if (authView === 'signup') await handleSignup();
      else if (authView === 'reset-password') await handleResetPassword();
      else if (authView === 'magic-link') await handleMagicLink();
    } catch (error) {
      console.error('Auth error:', error);
      showSnackbar(error.message || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider) => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (error) {
      console.error(`${provider} login error:`, error);
      showSnackbar(`${provider} login failed: ${error.message}`, 'error');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setWs(null);
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

      if (user && user.id) {
        try {
          localStorage.removeItem(`chatMessages_${user.id}`);
        } catch (e) {
          console.error("Failed to remove messages from localStorage on logout", e);
        }
      }

      await supabase.auth.signOut();
      // setUser(null) will be handled by onAuthStateChange
      setMessages([]);
      setConnectionStatus('disconnected');
      setCurrentAssistant('ToGeneralAssistant');
      prevBackendAssistantIdRef.current = 'ToGeneralAssistant'; // Reset the ref
      setInitialMessagesLoaded(false);
      setPreviousAssistant(null);
      setTransferInProgress(false);

    } catch (error) {
      console.error('Logout error:', error);
      showSnackbar('Logout failed: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConversation = () => {
    if (user && user.id) {
      localStorage.removeItem(`chatMessages_${user.id}`);
    }
    setMessages([]);
    // Optionally reset assistant to general if desired after deleting conversation
    // setCurrentAssistant('ToGeneralAssistant');
    // prevBackendAssistantIdRef.current = 'ToGeneralAssistant';
    showSnackbar('Conversation deleted.', 'success');
  };

  const connectWebSocket = () => {
    if (!user || !user.email) {
      console.log("User or user email not available, WebSocket connection skipped.");
      return;
    }
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();
      const wsUrl = `${WS_URL}?sessionId=${encodeURIComponent(user.email)}`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;
      socket.onopen = handleSocketOpen;
      socket.onmessage = handleSocketMessage;
      socket.onclose = handleSocketClose;
      socket.onerror = handleSocketError;
      setWs(socket);
    } catch (error) {
      console.error('WebSocket connection error:', error);
      setConnectionStatus('error');
      handleReconnect();
    }
  };

  const handleSocketOpen = () => {
    console.log('WebSocket connected');
    setConnectionStatus('connected');
    setReconnectAttempts(0);
    startHeartbeat();
  };

  const handleSocketMessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received message from server:', data);
      setTypingIndicator(false);

      if (data.error) {
        showSnackbar(`Server error: ${data.error}`, 'error');
        return;
      }

      const newAssistantIdFromBackend = getCurrentAssistant(data); // Get assistant ID from current backend message

      // --- CORE LOGIC FOR ASSISTANT TRANSITION ---
      // Only trigger a UI transition if the assistant ID from *this* backend message
      // is different from the assistant ID in the *previous* backend message that specified an assistant,
      // AND it's a valid, known assistant.
      if (newAssistantIdFromBackend &&
          assistantConfig[newAssistantIdFromBackend] && // Check if it's a known/configured assistant
          newAssistantIdFromBackend !== prevBackendAssistantIdRef.current) {

        console.log(`Assistant change detected by backend. Previous backend ref: ${prevBackendAssistantIdRef.current}, New from backend: ${newAssistantIdFromBackend}. UI will transition from ${currentAssistant}.`);

        // The backend has indicated a new/different assistant than its last message.
        // Proceed with the UI update and transition.
        setPreviousAssistant(currentAssistant); // `currentAssistant` is the UI's current active assistant
        setCurrentAssistant(newAssistantIdFromBackend); // Update UI to the new assistant
        setTransferInProgress(true); // Start the visual transition

        // Add the system message about the transfer
        setMessages(prev => [
          ...prev,
          {
            id: `system-${Date.now()}`,
            content: `Transferring you to our ${assistantConfig[newAssistantIdFromBackend]?.name || 'specialized assistant'}...`,
            sender: 'system',
            timestamp: new Date().toISOString()
          }
        ]);

        // Set a timeout to end the visual transition
        setTimeout(() => {
          setTransferInProgress(false);
        }, 800); // Match this duration to your desired transition time
      }
      // --- END OF CORE LOGIC FOR ASSISTANT TRANSITION ---

      // Update the reference to the previous backend assistant ID.
      // This should only be updated if the backend provided a new *valid* assistant ID.
      // If newAssistantIdFromBackend is empty or invalid, prevBackendAssistantIdRef.current
      // will retain its value, reflecting the last known valid assistant context from the backend.
      if (newAssistantIdFromBackend && assistantConfig[newAssistantIdFromBackend]) {
        prevBackendAssistantIdRef.current = newAssistantIdFromBackend;
      }

      // Handle the actual response message from the assistant
      if (data.response) {
        const messageId = `assistant-${Date.now()}`;
        
        // Determine the assistant type for this specific message.
        // This should be the assistant that is *currently supposed to be active*
        // according to the latest backend directive that caused a UI change,
        // or the one the backend last specified if no UI change was needed.
        let assistantForThisMessageResponse = currentAssistant; // Default to UI's current assistant state

        // If a transition just happened, newAssistantIdFromBackend is the target.
        // If no transition (because backend assistant didn't change from its previous message),
        // the assistant for this message is whatever the backend last told us (prevBackendAssistantIdRef.current),
        // or fallback to UI's currentAssistant.
        if (newAssistantIdFromBackend && assistantConfig[newAssistantIdFromBackend]) {
            assistantForThisMessageResponse = newAssistantIdFromBackend;
        } else if (prevBackendAssistantIdRef.current && assistantConfig[prevBackendAssistantIdRef.current]) {
            // If backend didn't specify an assistant in this message, but did previously, use that.
            assistantForThisMessageResponse = prevBackendAssistantIdRef.current;
        }
        // If neither, it defaults to currentAssistant (UI state), which should be the stable one.

        const newAssistantMessage = {
          id: messageId,
          content: '', // Will be filled by streaming
          sender: 'assistant',
          timestamp: new Date().toISOString(),
          assistantType: assistantForThisMessageResponse, // Assign the determined assistant type
          streaming: true,
        };
        setMessages(prev => [...prev, newAssistantMessage]);
        streamMessageContent(messageId, data.response);
      }

      // Handle other types of messages from the backend (e.g., typing, pong)
      switch (data.type) {
        case 'connected':
          console.log('Connection established with ID:', data.clientId);
          break;
        case 'typing':
          setTypingIndicator(data.value);
          break;
        case 'pong':
          console.log("Pong received");
          break;
        default:
          // If data.response was handled, we might not want to log "unhandled" for the same message.
          if (!data.response) {
            console.log('Received unhandled message structure or type:', data);
          }
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
      console.error('Raw message data:', event.data);
      showSnackbar('Error processing message from server.', 'error');
    }
  };


  const handleSocketClose = (event) => {
    console.log(`WebSocket closed: ${event.code} - ${event.reason}`);
    setConnectionStatus('disconnected');
    handleReconnect();
  };

  const handleSocketError = (error) => {
    console.error('WebSocket error:', error);
    setConnectionStatus('error');
    // No need to call handleReconnect here, onclose will be called subsequently
  };

  const handleReconnect = () => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    if (!user) { // Don't attempt to reconnect if user is logged out
        setConnectionStatus('disconnected');
        return;
    }
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionStatus('failed');
      showSnackbar('Failed to reconnect after multiple attempts. Please check your connection or try logging out and in.', 'error');
      return;
    }
    setConnectionStatus('reconnecting');
    setReconnectAttempts(prev => prev + 1);
    reconnectTimeoutRef.current = setTimeout(() => {
      console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
      connectWebSocket();
    }, RECONNECT_INTERVAL * Math.pow(2, Math.min(reconnectAttempts, 4))); // Exponential backoff
  };

  const startHeartbeat = () => {
    const heartbeatInterval = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('Failed to send heartbeat:', error);
          clearInterval(heartbeatInterval); // Stop if sending fails
        }
      } else {
        clearInterval(heartbeatInterval); // Stop if socket is not open
      }
    }, 25000); // 25 seconds
    return () => clearInterval(heartbeatInterval); // Cleanup on component unmount or when heartbeat stops
  };

  const safeSendMessage = (message) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showSnackbar('Not connected to server. Please wait or try reconnecting.', 'error');
      return false;
    }
    try {
      wsRef.current.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      showSnackbar('Failed to send message. Please try again.', 'error');
      return false;
    }
  };

  useEffect(() => {
    if (user && user.email) {
        connectWebSocket();
    } else {
      // If user logs out or becomes null
      if (wsRef.current) {
        wsRef.current.close(); // Explicitly close WebSocket
        wsRef.current = null;
        setWs(null);
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      setConnectionStatus('disconnected');
    }

    // Cleanup function for when the user changes (e.g., logs out) or component unmounts
    return () => {
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
        setWs(null);
      }
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [user?.email]); // Re-run effect if user.email changes (login/logout)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const checkUser = async () => {
      setLoading(true);
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (session?.user) {
          setUser(session.user);
          // On initial load, if there are stored messages, try to infer the last assistant
          // This is now handled in the initialMessagesLoaded useEffect
          showSnackbar(`Welcome back, ${session.user.email}!`, 'success');
        } else {
          setLoginDialogOpen(true);
        }
      } catch (error) {
        console.error('Session check error:', error);
        showSnackbar('Error checking session', 'error');
      } finally {
        setLoading(false);
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth event:', event, session);
        setUser(session?.user ?? null); // Update user state based on session

        if (event === 'SIGNED_IN') {
          setLoginDialogOpen(false);
          // Reset assistant states on new sign-in for a clean slate
          setCurrentAssistant('ToGeneralAssistant');
          prevBackendAssistantIdRef.current = 'ToGeneralAssistant';
          setPreviousAssistant(null);
          setTransferInProgress(false);
          setInitialMessagesLoaded(false); // Allow messages to load for the new user
          setMessages([]); // Clear messages from previous user
          showSnackbar(`Successfully signed in as ${session.user.email}!`, 'success');
        } else if (event === 'SIGNED_OUT') {
          setLoginDialogOpen(true);
          setMessages([]); // Clear messages on sign out
          setCurrentAssistant('ToGeneralAssistant');
          prevBackendAssistantIdRef.current = 'ToGeneralAssistant';
          setPreviousAssistant(null);
          setTransferInProgress(false);
          setInitialMessagesLoaded(false);
          showSnackbar('You have been signed out', 'info');
        } else if (event === 'PASSWORD_RECOVERY') {
          // This event means the user clicked the password recovery link.
          // You might want to show a view to set a new password.
          setAuthView('reset-password'); // Ensure this view allows setting new password
          setLoginDialogOpen(true);
          showSnackbar('You can now set a new password.', 'info');
        } else if (event === 'USER_UPDATED') {
          showSnackbar('Your profile has been updated.', 'success');
        } else if (event === 'TOKEN_REFRESHED') {
          console.log('Supabase token refreshed');
        }
      }
    );
    return () => subscription?.unsubscribe();
  }, []); // Empty dependency array for onAuthStateChange

  const showSnackbar = (message, severity = 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar({ ...snackbar, open: false });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || !wsRef.current || !user || connectionStatus !== 'connected') {
      if (connectionStatus !== 'connected') showSnackbar('Not connected to the chat server.', 'warning');
      if (!user) showSnackbar('Please sign in to send messages.', 'warning');
      return;
    }
    const messageId = `user-${Date.now()}`;
    const newMessage = {
      id: messageId,
      content: inputMessage,
      sender: 'user',
      timestamp: new Date().toISOString()
    };
    setMessages(prevMessages => [...prevMessages, newMessage]);
    setInputMessage('');
    setTypingIndicator(true); // Show typing indicator for assistant immediately
    safeSendMessage({
      type: 'message',
      message: inputMessage,
      sessionId: user.email, // Ensure sessionId is being sent
      // Optionally, send the UI's current assistant so backend knows the context if it needs it
      // currentAssistantContext: currentAssistant // Or prevBackendAssistantIdRef.current
    });
  };

  const renderAuthDialog = () => {
    const getDialogTitle = () => {
      switch (authView) {
        case 'login': return 'Sign In';
        case 'signup': return 'Create Account';
        case 'reset-password': return 'Reset Password'; // Simplified title
        case 'magic-link': return 'Sign In with Magic Link';
        default: return 'Authentication';
      }
    };

    return (
      <Dialog
        open={loginDialogOpen && !user} // Only open if not logged in
        fullWidth
        maxWidth="xs"
        disableEscapeKeyDown // Prevent closing with escape if no user
        PaperProps={{
          component: 'form', // Make Dialog Paper a form
          onSubmit: handleAuthSubmit,
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          {authView !== 'login' && authView !== 'signup' && (
            <IconButton
              edge="start"
              color="inherit"
              onClick={() => { setAuthView('login'); clearAuthFields(); }}
              aria-label="back"
              sx={{ mr: 1, position: 'absolute', left: theme.spacing(2), top: theme.spacing(1.5) }}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          {getDialogTitle()}
        </DialogTitle>

        {(authView === 'login' || authView === 'signup') && (
          <Tabs
            value={authView}
            onChange={(e, newValue) => { setAuthView(newValue); clearAuthFields(); }}
            centered
            indicatorColor="primary"
            textColor="primary"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="Sign In" value="login" />
            <Tab label="Sign Up" value="signup" />
          </Tabs>
        )}

        <DialogContent>
          <Box sx={{ mt: authView === 'login' || authView === 'signup' ? 2 : 1 }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="email"
              label="Email Address"
              name="email"
              autoComplete="email"
              autoFocus
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              InputProps={{
                startAdornment: <EmailIcon color="action" sx={{ mr: 1 }} />
              }}
            />

            {/* Show password field for login, signup, and when setting new password (authView === 'reset-password' && user is on reset page) */}
            {(authView === 'login' || authView === 'signup' || (authView === 'reset-password' && window.location.hash.includes('type=recovery'))) && (
              <TextField
                margin="normal"
                required
                fullWidth
                name="password"
                label={authView === 'reset-password' ? "New Password" : "Password"}
                type="password"
                id="password"
                autoComplete={authView === 'signup' || authView === 'reset-password' ? 'new-password' : 'current-password'}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                InputProps={{
                  startAdornment: <LockIcon color="action" sx={{ mr: 1 }} />
                }}
              />
            )}

            {authView === 'signup' && (
              <TextField
                margin="normal"
                required
                fullWidth
                name="confirmPassword"
                label="Confirm Password"
                type="password"
                id="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                error={confirmPassword !== '' && confirmPassword !== authPassword}
                helperText={confirmPassword !== '' && confirmPassword !== authPassword ? 'Passwords do not match' : ''}
                InputProps={{
                  startAdornment: <LockIcon color="action" sx={{ mr: 1 }} />
                }}
              />
            )}
             {(authView === 'reset-password' && window.location.hash.includes('type=recovery')) && (
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="confirmNewPassword"
                    label="Confirm New Password"
                    type="password"
                    id="confirmNewPassword"
                    autoComplete="new-password"
                    value={confirmPassword} // Re-using confirmPassword state for this
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    error={confirmPassword !== '' && confirmPassword !== authPassword}
                    helperText={confirmPassword !== '' && confirmPassword !== authPassword ? "Passwords do not match" : ""}
                    InputProps={{
                        startAdornment: <LockIcon color="action" sx={{ mr: 1 }} />
                    }}
                />
            )}


            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={loading || (authView === 'signup' && authPassword !== confirmPassword) || (authView === 'reset-password' && window.location.hash.includes('type=recovery') && authPassword !== confirmPassword)}
            >
              {loading ? (
                <CircularProgress size={24} />
              ) : (
                {
                  'login': 'Sign In',
                  'signup': 'Create Account',
                  'reset-password': window.location.hash.includes('type=recovery') ? 'Set New Password' : 'Send Reset Link',
                  'magic-link': 'Send Magic Link'
                }[authView]
              )}
            </Button>

            {authView === 'login' && (
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => {
                    setAuthView('reset-password');
                    clearAuthFields(); // Clear email for reset if desired, or keep it
                  }}
                >
                  Forgot password?
                </Link>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => {
                    setAuthView('magic-link');
                    clearAuthFields(); // Clear email for magic link if desired
                  }}
                >
                  Use Magic Link
                </Link>
              </Box>
            )}

            {(authView === 'login' || authView === 'signup') && (
              <>
                <Divider sx={{ mt: 2, mb: 2 }}><Chip label="OR" /></Divider>
                <Grid container spacing={1}>
                  <Grid item xs={12}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<GoogleIcon />}
                      onClick={() => handleSocialLogin('google')}
                      disabled={loading}
                    >
                      Continue with Google
                    </Button>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<GitHubIcon />}
                      onClick={() => handleSocialLogin('github')}
                      disabled={loading}
                    >
                      GitHub
                    </Button>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<FacebookIcon />}
                      onClick={() => handleSocialLogin('facebook')}
                      disabled={loading}
                    >
                      Facebook
                    </Button>
                  </Grid>
                </Grid>
              </>
            )}
          </Box>
        </DialogContent>
         {authView !== 'login' && authView !== 'signup' && (
            <DialogActions sx={{ justifyContent: 'center', pb:2 }}>
                <Button onClick={() => { setAuthView('login'); clearAuthFields(); }}>
                    Back to Sign In
                </Button>
            </DialogActions>
        )}
      </Dialog>
    );
  };

  const renderConnectionStatus = () => {
    const getStatusComponent = () => {
      switch (connectionStatus) {
        case 'connected':
          return (
            <Chip
              size="small"
              label="Connected"
              color="success"
              sx={{ mr: 1 }}
              icon={<Box sx={{ width: 8, height: 8, bgcolor: 'success.light', borderRadius: '50%', mr: -0.5 }} />}
            />
          );
        case 'disconnected':
          return (
            <Chip
              size="small"
              label="Disconnected"
              color="error"
              sx={{ mr: 1 }}
              icon={<Box sx={{ width: 8, height: 8, bgcolor: 'error.light', borderRadius: '50%', mr: -0.5 }} />}
            />
          );
        case 'reconnecting':
          return (
            <Chip
              size="small"
              label="Reconnecting..."
              color="warning"
              sx={{ mr: 1 }}
              icon={<CircularProgress size={10} sx={{ mr: -0.5, color:'inherit' }} />}
            />
          );
        case 'error':
        case 'failed':
          return (
            <Chip
              size="small"
              label={connectionStatus === 'error' ? 'Connection Error' : 'Connection Failed'}
              color="error"
              sx={{ mr: 1 }}
              icon={<Box sx={{ width: 8, height: 8, bgcolor: 'error.light', borderRadius: '50%', mr: -0.5 }} />}
            />
          );
        default:
          return null;
      }
    };

    return isMobile ?
      <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>{getStatusComponent()}</Box> :
      getStatusComponent();
  };

  const renderMessage = (message, index) => {
    const isUser = message.sender === 'user';
    const isSystem = message.sender === 'system';

    // For assistant messages, use message.assistantType if available, otherwise fallback to UI's currentAssistant
    // which should be accurate due to the refined handleSocketMessage logic.
    const assistantTypeForMessage = message.assistantType || currentAssistant;
    const msgAssistantConfig = !isUser && !isSystem ? (assistantConfig[assistantTypeForMessage] || assistantConfig.ToGeneralAssistant) : null;

    const bubbleColor = isUser ? theme.palette.primary.main : (msgAssistantConfig?.color || '#e0e0e0');
    const textColor = isUser ? theme.palette.primary.contrastText : (msgAssistantConfig ? theme.palette.getContrastText(msgAssistantConfig.color) : theme.palette.text.primary);

    if (isSystem) {
      return (
        <ListItem
          key={message.id || index}
          sx={{
            justifyContent: 'center',
            py: 1,
          }}
        >
          <Chip
            label={message.content}
            variant="outlined"
            size="small"
            sx={{ fontSize: '0.75rem', fontStyle: 'italic', backgroundColor: 'rgba(0,0,0,0.03)', color: 'text.secondary' }}
          />
        </ListItem>
      );
    }

    return (
      <ListItem
        key={message.id || index}
        sx={{
          flexDirection: 'column',
          alignItems: isUser ? 'flex-end' : 'flex-start',
          padding: '8px 16px',
        }}
      >
        <Box
          sx={{
            position: 'relative',
            backgroundColor: bubbleColor,
            color: textColor,
            borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
            padding: '10px 14px',
            maxWidth: '75%',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            // Removed pseudo-elements for tails for a cleaner look, can be added back if desired
          }}
        >
          {!isUser && !isSystem && msgAssistantConfig && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              <Avatar sx={{ width: 20, height: 20, mr: 0.75, bgcolor: 'transparent', color: textColor, fontSize: '1rem' }}>
                {React.cloneElement(msgAssistantConfig.icon, {fontSize: 'inherit'})}
              </Avatar>
              <Typography variant="caption" sx={{ fontWeight: 500, opacity: 0.9, color: textColor }}>
                {msgAssistantConfig.name || 'Assistant'}
              </Typography>
            </Box>
          )}
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.content}
            {message.streaming && (
              <Box component="span" sx={{
                display: 'inline-block',
                width: '8px',
                height: '1em',
                backgroundColor: textColor, // Or a contrasting color
                animation: 'blinkingCursor 0.7s infinite',
                marginLeft: '2px',
                verticalAlign: 'text-bottom',
                '@keyframes blinkingCursor': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0 },
                }
              }}/>
            )}
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          mt: 0.5,
          color: 'text.secondary',
          pl: isUser ? 0 : 0.5,
          pr: isUser ? 0.5 : 0,
        }}>
          <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Typography>
        </Box>
      </ListItem>
    );
  };

  const renderTypingIndicator = () => {
    if (typingIndicator) {
      // Typing indicator should reflect the assistant expected to reply.
      // This is likely the assistant the backend last indicated, or the current UI assistant if no specific backend indication recently.
      const typingAssistantId = (prevBackendAssistantIdRef.current && assistantConfig[prevBackendAssistantIdRef.current])
                                ? prevBackendAssistantIdRef.current
                                : currentAssistant;
      const config = assistantConfig[typingAssistantId] || assistantConfig.ToGeneralAssistant;


      return (
        <Fade in={typingIndicator} timeout={300}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          pl: 2,
          pb: 1,
          pt: 0.5,
          opacity: 0.8
        }}>
          <Avatar
            sx={{
              width: 24,
              height: 24,
              mr: 1,
              bgcolor: config.color,
              color: theme.palette.getContrastText(config.color),
              fontSize: '0.9rem'
            }}
          >
            {React.cloneElement(config.icon, {fontSize: 'inherit'})}
          </Avatar>
          <Box sx={{
            display: 'flex',
            alignItems: 'center'
          }}>
            <Box sx={{
              display: 'flex',
              alignItems: 'flex-end', // Align dots to bottom
              height: 20 // Fixed height for dot container
            }}>
              {[0, 1, 2].map((i) => (
                <Box
                  key={i}
                  component="span"
                  sx={{
                    width: 6, // Slightly larger dots
                    height: 6,
                    margin: '0 1.5px', // Adjust spacing
                    borderRadius: '50%',
                    background: config.color, // Use assistant's color
                    display: 'inline-block',
                    animation: 'typing-animation 1.4s infinite ease-in-out',
                    animationDelay: `${i * 0.25}s`, // Stagger animation
                    '@keyframes typing-animation': {
                      '0%, 80%, 100%': {
                        transform: 'scale(0.5) translateY(0)', opacity: 0.7,
                      },
                      '40%': {
                        transform: 'scale(1) translateY(-3px)', opacity: 1,
                      },
                    },
                  }}
                />
              ))}
            </Box>
            <Typography variant="caption" sx={{ ml: 1.5, color: 'text.secondary', fontStyle: 'italic' }}>
              {config.name || 'Assistant'} is typing...
            </Typography>
          </Box>
        </Box>
        </Fade>
      );
    }
    return null;
  };

  const renderMessageInput = () => {
    return (
      <Box component="form" onSubmit={handleSendMessage} sx={{ p: 2, backgroundColor: 'background.paper', borderTop: `1px solid ${theme.palette.divider}` }}>
        <Grid container spacing={1} alignItems="center">
          <Grid item xs>
            <TextField
              fullWidth
              variant="outlined"
              placeholder="Type your message..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={loading || connectionStatus !== 'connected' || !user || transferInProgress}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  handleSendMessage(e);
                }
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '24px',
                  backgroundColor: theme.palette.mode === 'light' ? '#ffffff' : theme.palette.grey[800],
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  '&:hover': {
                    boxShadow: '0 2px 5px rgba(0,0,0,0.08)',
                  },
                  '&.Mui-focused': {
                    boxShadow: `0 0 0 2px ${theme.palette.primary.light}`,
                  }
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'rgba(0, 0, 0, 0.1)',
                }
              }}
            />
          </Grid>
          <Grid item>
            <IconButton
              color="primary"
              type="submit"
              disabled={!inputMessage.trim() || loading || connectionStatus !== 'connected' || !user || transferInProgress}
              sx={{
                backgroundColor: theme.palette.primary.main,
                color: 'white',
                width: 48,
                height: 48,
                boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                '&:hover': {
                  backgroundColor: theme.palette.primary.dark,
                },
                '&.Mui-disabled': {
                  backgroundColor: theme.palette.action.disabledBackground,
                  color: theme.palette.action.disabled,
                }
              }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : <SendIcon />}
            </IconButton>
          </Grid>
        </Grid>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      {renderAuthDialog()}

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%', boxShadow: 3 }}>{snackbar.message}</Alert>
      </Snackbar>

      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Toolbar>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="h6" component="div" sx={{
              fontWeight: 600,
              background: `linear-gradient(45deg, ${theme.palette.primary.main} 30%, ${theme.palette.secondary.main} 90%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              RamsesAI Support
            </Typography>
            <Chip
              label="Beta"
              size="small"
              sx={{ ml: 1, height: 20, fontSize: '0.6rem', bgcolor: theme.palette.secondary.light, color: theme.palette.secondary.contrastText }}
              color="secondary"
            />
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          {user && (
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              sx={{ mr: 2, textTransform: 'none', borderColor: theme.palette.divider }}
              onClick={handleDeleteConversation}
            >
              Delete Chat
            </Button>
          )}

          {renderConnectionStatus()}

          {user && (
            <>
              <Badge
                overlap="circular"
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                variant="dot"
                sx={{
                    '& .MuiBadge-badge': {
                      backgroundColor: connectionStatus === 'connected' ? theme.palette.success.main : theme.palette.error.main,
                      color: connectionStatus === 'connected' ? theme.palette.success.main : theme.palette.error.main,
                      boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
                    }
                }}
              >
                <Avatar sx={{ bgcolor: theme.palette.primary.main, ml: isMobile ? 0 : 2, width: 36, height: 36 }} alt={user.email} src={user.user_metadata?.avatar_url || ''}>
                  {user.email?.[0]?.toUpperCase()}
                </Avatar>
              </Badge>
              {!isMobile && (
                <Typography variant="subtitle2" sx={{ ml: 1, mr: 2, color: 'text.secondary' }}>
                  {user.email}
                </Typography>
              )}
              <IconButton color="inherit" onClick={handleLogout} disabled={loading} size="small" sx={{ ml: isMobile ? 1 : 0}}>
                {loading ? <CircularProgress size={24} color="inherit" /> : <LogoutIcon />}
              </IconButton>
            </>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ position: 'relative', zIndex: 10 }}> {/* Ensure header is above chat content */}
        {previousAssistant && transferInProgress && assistantConfig[previousAssistant] && (
          <Fade in={transferInProgress} timeout={300}>
            <Paper // Fading out previous assistant
              elevation={0} // No shadow, it's behind
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1, 
                backgroundColor: assistantConfig[previousAssistant]?.color || '#1976d2',
                color: theme.palette.getContrastText(assistantConfig[previousAssistant]?.color || '#1976d2'),
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                borderRadius: '0 0 12px 12px',
                opacity: 0.6, 
              }}
            >
              <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'inherit', mr: 2 }}>
                {assistantConfig[previousAssistant]?.icon || <SupportIcon />}
              </Avatar>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 500 }}>
                  {assistantConfig[previousAssistant]?.name || 'Assistant'}
                </Typography>
                 {!isMobile && (
                    <Typography variant="caption">{assistantConfig[previousAssistant]?.description}</Typography>
                )}
              </Box>
            </Paper>
          </Fade>
        )}

        <AssistantHeader
          assistant={currentAssistant}
          transferInProgress={transferInProgress}
          config={assistantConfig[currentAssistant] || assistantConfig.ToGeneralAssistant}
          isMobile={isMobile}
        />

        {transferInProgress && (
          <Fade in={transferInProgress} timeout={500} style={{ transitionDelay: '100ms' }}>
            <Box sx={{ // Transfer overlay
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom:0, 
              zIndex: 2, 
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(0,0,0,0.2)', 
              backdropFilter: 'blur(2px)',
              padding: 2,
              borderRadius: '0 0 12px 12px',
              color: 'white',
            }}>
              <CircularProgress size={28} sx={{color: 'white', mb:1.5}}/>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                Transferring to {assistantConfig[currentAssistant]?.name || 'Assistant'}...
              </Typography>
            </Box>
          </Fade>
        )}
      </Box>

      <Container
        maxWidth="md"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          py: 2,
          px: { xs: 0, sm: 1, md: 2 }, // Adjust padding for different screen sizes
          overflow: 'hidden', // Prevent container itself from scrolling
        }}
      >
        <Paper
          elevation={1}
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100%', // Make paper take full height of container
            overflow: 'hidden', // Paper handles its own scrolling
            borderRadius: { xs: 0, sm: 2 }, // No border radius on xs
            border: `1px solid ${theme.palette.divider}`,
            bgcolor: 'background.paper'
          }}
        >
          <Box sx={{
            flexGrow: 1,
            overflowY: 'auto', // Only vertical scroll
            overflowX: 'hidden',
            // backgroundImage: 'url("https://www.transparenttextures.com/patterns/subtle-white-feathers.png")',
            // backgroundColor: theme.palette.mode === 'light' ? '#f5f7fa' : theme.palette.grey[900],
            p: { xs: 1, sm: 2 }
          }}>
            <List sx={{ py: 0 }}>
              {messages.length === 0 && !user && (
                <ListItem>
                  <ListItemText primary={
                    <Typography variant="body1" align="center" sx={{ color: 'text.secondary', py: 4 }}>
                      Please sign in to start chatting.
                    </Typography>
                  } />
                </ListItem>
              )}

              {messages.length === 0 && user && !loading && ( // Added !loading
                <Box sx={{
                  py: {xs: 4, sm: 8},
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center'
                }}>
                  <Avatar
                    sx={{
                      width: {xs: 60, sm: 80},
                      height: {xs: 60, sm: 80},
                      mb: 2,
                      p: 1,
                      bgcolor: (assistantConfig[currentAssistant] || assistantConfig.ToGeneralAssistant).color || theme.palette.primary.light,
                      color: theme.palette.getContrastText((assistantConfig[currentAssistant] || assistantConfig.ToGeneralAssistant).color || theme.palette.primary.light)
                    }}
                  >
                    {React.cloneElement((assistantConfig[currentAssistant] || assistantConfig.ToGeneralAssistant).icon, { sx: { fontSize: {xs: 30, sm: 40} }})}
                  </Avatar>
                  <Typography variant={isMobile ? "h6" : "h5"} sx={{ mb: 1, fontWeight: 500 }}>
                    Welcome to RamsesAI Support!
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: '80%' }}>
                    How can {(assistantConfig[currentAssistant] || assistantConfig.ToGeneralAssistant).name || 'we'} help you today?
                  </Typography>
                </Box>
              )}

              {messages.map(renderMessage)}
              {renderTypingIndicator()}
              <div ref={messagesEndRef} />
            </List>
          </Box>

          {/* Message input is rendered outside the scrollable area */}
          {renderMessageInput()}
        </Paper>
      </Container>

      {/* Keyframes can be defined in a <style> tag in index.html or a CSS file if preferred */}
      <Box sx={{
        '@keyframes fadeIn': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        '@keyframes slideIn': { '0%': { transform: 'translateY(-5px)', opacity: 0 }, '100%': { transform: 'translateY(0)', opacity: 0.9 } }
      }} />
    </Box>
  );
}

export default App;