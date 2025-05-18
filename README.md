# RamsesAI Support Chatbot

## 1. Overall Application

**This entire multi-AI-agents project is built using LangGraph to orchestrate and manage each specialized agent.** LangGraph provides the underlying framework that allows individual agents to maintain separate chat histories, perform dynamic routing, and handle domain-specific logic.

The RamsesAI Support Chatbot is an intelligent, multi-agent chat application designed to provide customer support for RamsesAI, a fictional computer sales company. It aims to efficiently handle various customer inquiries by routing them to specialized AI assistants (General, Technical, Billing) and escalating to human support via email when necessary.

**Key Features:**

* **Multi-Agent System (via LangGraph):** Uses LangGraph’s node-and-workflow model to spin up separate AI agents—each with its own domain expertise (e.g., General Support, Technical Support, Billing).  
* **Independent Chat Histories:** Each LangGraph agent maintains its own conversation log with the user. These histories are completely isolated from one another, ensuring that each agent focuses only on its relevant context.  
* **Smart Routing by Agents:** While an initial “gateway” agent (also implemented as a LangGraph node) can route new queries, any specialized agent can dynamically transfer a user to another agent if the topic shifts. Conversely, if an agent is capable of resolving the issue, it will continue handling the conversation end-to-end.  
* **Persistent, Single-Agent Conversations:** Once a user is interacting with a LangGraph agent, they can have a multi-turn dialogue with that same agent—there is no need to bounce back through the generic router for each follow-up. This preserves context within that agent’s domain and reduces latency.  
* **Human Escalation:** At any point, the user can request human support; this action triggers an email notification to the appropriate support team.  
* **Persistent Conversations Across Sessions:** LangGraph’s state store ensures that each agent’s chat history is saved locally (in MongoDB). Users can pick up exactly where they left off if they return.  
* **Real-Time Streaming:** All AI responses are streamed character-by-character via Socket.IO for a more interactive feel.

 ![Multi-AI-Agents](multi-ai-agents.png)
## 2. Tech Stack

The application is built with a modern tech stack:

*   **Frontend:**
    *   **React:** A JavaScript library for building user interfaces.
    *   **Material-UI (MUI):** A popular React UI framework for a clean and responsive design.
    *   **Supabase (optional for full setup):** Used for user authentication.
    *   **WebSockets:** For real-time bidirectional communication with the backend.
*   **Backend:**
    *   **Node.js with TypeScript:** A JavaScript runtime built on Chrome's V8 JavaScript engine, with static typing via TypeScript.
    *   **LangGraph (LangChain):** A framework for building stateful, multi-actor applications with LLMs. Used to orchestrate the different AI support agents.
    *   **OpenAI API:** Powers the Large Language Models (LLMs) for the AI assistants.
    *   **WebSocket (ws library):** For real-time communication with the frontend.
    *   **SendGrid API:** For handling email escalations to human support.
    *   **PostgreSQL (optional for full setup):** Used as a persistent checkpointer for LangGraph conversation states. (The current setup might use `MemorySaver` for simplicity during development).
*   **Environment Management:**
    *   `dotenv`: To manage environment variables for API keys and other configurations.

## 3. Running the Application

To run the RamsesAI Support Chatbot locally, you'll need to set up both the backend and frontend services.

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later recommended)
*   [npm](https://www.npmjs.com/) (usually comes with Node.js)
*   Access to OpenAI API and a valid API key.
*   Access to SendGrid API and a valid API key (verified sender email required).
*   (Optional) PostgreSQL database if you intend to use `PostgresSaver` for LangGraph checkpoints.
*   (Optional) Supabase account and project setup if you want to use the full authentication features.

### Backend Setup

1.  **Navigate to the Backend Directory:**

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Set Up Environment Variables:**
    Create a `.env` file in the `backend` directory (`/c:/Users/KeepLearning/Downloads/Generative_AI/freelancing/langgraph_projects/human_escalation_project/backend/.env`).
    Add the following variables, replacing the placeholder values with your actual keys and settings:

    ```env
    # Backend .env
    OPENAI_API_KEY=sk-your_openai_api_key_here
    SENDGRID_API_KEY=SG.your_sendgrid_api_key_here
    POSTGRESQL_CONNECTION_STRING=postgresql://username:password@host:port/database_name 
    # (e.g., postgresql://postgres:RamsesAI@localhost:5432/TodosAppDB)
    # If you are using MemorySaver, POSTGRESQL_CONNECTION_STRING is not strictly needed for the app to run but good to have if you switch.
    
    PORT=3001 # Optional: Define the port for the backend WebSocket server
    ```
    *   **Note:** The `POSTGRESQL_CONNECTION_STRING` is configured in `server.ts` but the application currently uses `MemorySaver`. If you switch to `pg_checkpointer`, ensure this string is correct and your PostgreSQL server is running and accessible.

4.  **Build the TypeScript Code (if not using `tsx` for development):**
    If you plan to run the compiled JavaScript directly with `npm start`:
    ```bash
    npm run build
    ```

5.  **Run the Backend Server:**
    For development with auto-reloading (recommended):
    ```bash
    npm run dev
    ```
    This command uses `tsx` to watch for file changes and restart the server. The backend WebSocket server will typically start on `ws://localhost:3001` (or the port specified in your `.env` or `server.ts`).

    Alternatively, to run the compiled code (after `npm run build`):
    ```bash
    npm start
    ```

### Frontend Setup

1.  **Navigate to the Frontend Directory:**

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Set Up Environment Variables:**
    Create a `.env` file in the `frontend` directory (`/c:/Users/KeepLearning/Downloads/Generative_AI/freelancing/langgraph_projects/human_escalation_project/frontend/.env`).
    Add the following variables:

    ```env
    # Frontend .env
    REACT_APP_SUPABASE_URL=your_supabase_url_here 
    # (e.g., https://xyz.supabase.co)
    REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key_here
    REACT_APP_SOCKET_URL=ws://localhost:3001 
    # This should match the backend WebSocket server address
    ```
    *   **Note:** If you are not using Supabase for authentication, the `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` can be left blank or with placeholder values, but the application might have limited functionality regarding user login persistence across different browsers/devices. The core chat functionality will still work if the backend is running.

4.  **Run the Frontend Development Server:**
    ```bash
    npm start
    ```
    This will start the React development server, usually on `http://localhost:3000`, and open the application in your default web browser.

### Important Considerations

*   **API Keys:** Ensure your API keys (OpenAI, SendGrid) are correctly set in the backend's `.env` file and have the necessary permissions and billing enabled on their respective platforms.
*   **SendGrid Sender Verification:** For SendGrid to send emails, the `from` email address used in `server.ts` (e.g., `ramzi.rebai.01@gmail.com`) must be a verified sender in your SendGrid account.
*   **Ports:** Ensure that the ports used by the backend (default `3001`) and frontend (default `3000`) are not already in use by other applications. You can configure these if needed.
*   **Database (PostgreSQL):** If you switch from `MemorySaver` to `PostgresSaver` in `server.ts` for the LangGraph checkpointer, ensure your PostgreSQL server is running, the database exists, and the connection string is correct. You might also need to initialize the schema required by `PostgresSaver`.
*   **Supabase Setup:** For full user authentication features, you need to create a project in Supabase, enable authentication providers (like email/password, Google, etc.), and configure the redirect URLs correctly in your Supabase project settings to match your frontend's origin (e.g., `http://localhost:3000` for development).

Once both backend and frontend servers are running, you should be able to access the RamsesAI Support Chatbot in your browser (typically `http://localhost:3000`) and interact with the AI assistants.
