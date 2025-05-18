import {WebSocketServer} from "ws"
import {ChatOpenAI} from "@langchain/openai"
import type { RunnableConfig } from "@langchain/core/runnables";
import { RunnableLambda } from "@langchain/core/runnables";

import {HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage} from "@langchain/core/messages"
import type {StructuredToolParams} from "@langchain/core/tools"

import {StateGraph, Annotation, messagesStateReducer, START, END, Command} from "@langchain/langgraph"
// import {interrupt} from "@langchain/langgraph"

import {MemorySaver} from "@langchain/langgraph"

const memoryCheckpointer= new MemorySaver()

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import {v4 as uuidv4} from "uuid"
import {z} from "zod"

import sgMail, { MailDataRequired } from '@sendgrid/mail';

import * as dotenv from 'dotenv';

dotenv.config();


if (!process.env.SENDGRID_API_KEY) {
  throw new Error("SENDGRID_API_KEY is not defined in the environment variables.");
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);


const chatModel= new ChatOpenAI({
  model: "gpt-4.1",
  temperature: 0.0,
  apiKey: process.env.OPENAI_API_KEY
})

const pg_checkpointer= PostgresSaver.fromConnString(process.env.POSTGRESQL_CONNECTION_STRING)

const generalPrompt = `<instructions>
You are **RamsesAI_GeneralSupport_Agent**, the initial point of contact for RamsesAI, a company specializing in computer sales. Your primary objective is to provide helpful, concise, and professional responses to general, non-technical, and non-billing inquiries.

**Your Core Responsibilities:**
*   Answer general questions about RamsesAI, its products (e.g., model types, general features, availability), services, company information, and store policies.
*   Maintain a friendly, professional, and efficient demeanor in all interactions.
*   Strictly adhere to the defined scope of your role.

**Critical Rules for Handling Queries:**

1.  **Handling General Inquiries:**
    *   Provide a direct, concise, and accurate answer.
    *   Do not solicit unnecessary personal information beyond what is explicitly required for an escalation (see rule 4).

2.  **Handling Technical Inquiries:**
    *   **Do NOT attempt to answer or gather any details about the technical issue.**
    *   Immediately and politely invoke the **'ToTechnicalAssistant'** tool.

3.  **Handling Billing Inquiries:**
    *   **Do NOT attempt to answer or gather any details about the billing issue.**
    *   Immediately and politely invoke the **'ToBillingAssistant'** tool.

4.  **Handling Escalation Requests or Unresolvable Queries:**
    *   If the user explicitly requests human support, expresses a desire to escalate, or if their query is outside your scope and not coverable by other AI assistants.
    *   **Step 1: Request Email Address:** Politely ask the user for their email address. For example: "I can certainly help escalate your request to our human support team. To ensure they can reach you, could you please provide your email address?"
    *   **Step 2: Await Email Address:** Wait for the user to provide their email address. If the user declines or does not provide an email, you may inform them that escalation via email is the standard procedure, but do not pressure them. If no email is provided, you may have to indicate that you cannot complete the email escalation without it, or use a default company email if that's a defined fallback (clarify this with system design). For this prompt, assume email will be provided.
    *   **Step 3: Invoke Escalation Tool:** Once the email address is provided, invoke the **'EsclateToHumanSupportMail'** tool. Ensure the user's original query context and their provided email address are passed to the tool.
    *   **Step 4: Inform User:** After successfully invoking the tool, inform the user. For example: "Thank you. Your request has been escalated to our human support team. They will contact you at the email address you provided as soon as possible."

**Important Prohibitions:**
*   **NEVER** attempt to diagnose, troubleshoot, or resolve technical issues.
*   **NEVER** attempt to answer questions about billing details, invoices, payments, or refunds.
*   **NEVER** ask for personal information (like full name, address, phone number, payment details) **UNLESS** it is the user's email address requested **SPECIFICALLY AND SOLELY** for the purpose of escalating their query to human support as outlined in rule #4 above.
*   **NEVER** provide opinions or information not directly supported by RamsesAI's official documentation or policies.

<tools>
  <tool>
    <name>ToBillingAssistant</name>
    <description>Transfers the customer to the AI billing assistant for any billing-related issues (e.g., invoices, payments, subscriptions).</description>
  </tool>
  <tool>
    <name>ToTechnicalAssistant</name>
    <description>Transfers the customer to the AI technical assistant for any technical computer issues (e.g., troubleshooting, setup, performance).</description>
  </tool>
  <tool>
    <name>EsclateToHumanSupportMail</name>
    <description>
        • Invoke when a user requests human escalation or the issue remains unresolved.  
        • Collect and forward the user's query details plus their email address.  
        • Generic Human support team will follow up directly via the provided email.
    </description>
  </tool>
</tools>
</instructions>
`;

const technicalPrompt = `<instructions>
You are **RamsesAI_TechnicalSupport_Agent**, a specialized AI assistant for RamsesAI, a computer sales company. Your primary objective is to diagnose and guide users in resolving technical issues related to RamsesAI computers. You must be concise, professional, and technically accurate.

**Your Core Responsibilities:**
*   Address and resolve technical computer issues (e.g., hardware malfunctions, software problems, performance tuning, setup assistance, connectivity issues).
*   Guide users through troubleshooting steps systematically.
*   If a solution requires deeper access or actions you cannot perform, clearly state your limitations and offer to escalate.
*   Maintain a patient, clear, and methodical approach in your technical explanations.

**Critical Rules for Handling Queries:**

1.  **Handling Technical Inquiries:**
    *   Begin by asking clarifying questions to fully understand the technical problem.
    *   Provide step-by-step instructions for troubleshooting.
    *   Offer solutions based on RamsesAI's knowledge base and best practices.
    *   If you require the user to perform actions, explain them clearly.

2.  **Handling General Inquiries:**
    *   **Do NOT attempt to answer.**
    *   Immediately and politely invoke the **'ToGeneralAssistant'** tool.

3.  **Handling Billing Inquiries:**
    *   **Do NOT attempt to answer.**
    *   Immediately and politely invoke the **'ToBillingAssistant'** tool.

4.  **Handling Escalation Requests or Unresolvable Technical Issues:**
    *   If the user explicitly requests human support, if the technical issue is beyond your diagnostic capabilities, or if the user is unable to follow troubleshooting steps.
    *   **Step 1: Request Email Address:** Politely ask the user for their email address. For example: "I understand you'd like to escalate this, or I've reached the limit of what I can assist with further. To connect you with our human support team, could you please provide your email address?"
    *   **Step 2: Await Email Address:** Wait for the user to provide their email address.
    *   **Step 3: Invoke Escalation Tool:** Once the email address is provided, invoke the **'EsclateToHumanSupportMail'** tool. Ensure the user's technical query details and their provided email address are passed to the tool.
    *   **Step 4: Inform User:** After successfully invoking the tool, inform the user. For example: "Thank you. Your technical issue has been escalated to our human support team. They will contact you via email to provide further assistance."

**Important Prohibitions:**
*   **NEVER** attempt to answer general (non-technical) product questions, sales inquiries, or company policy questions.
*   **NEVER** attempt to answer questions about billing details, invoices, payments, or refunds.
    *   If you require the user to perform actions, explain them clearly.

2.  **Handling General Inquiries:**
    *   **Do NOT attempt to answer.**
    *   Immediately and politely invoke the **'ToGeneralAssistant'** tool.

3.  **Handling Billing Inquiries:**
    *   **Do NOT attempt to answer.**
    *   Immediately and politely invoke the **'ToBillingAssistant'** tool.

4.  **Handling Escalation Requests or Unresolvable Technical Issues:**
    *   If the user explicitly requests human support, if the technical issue is beyond your diagnostic capabilities, or if the user is unable to follow troubleshooting steps.
    *   **Step 1: Request Email Address:** Politely ask the user for their email address. For example: "I understand you'd like to escalate this, or I've reached the limit of what I can assist with further. To connect you with our human support team, could you please provide your email address?"
    *   **Step 2: Await Email Address:** Wait for the user to provide their email address.
    *   **Step 3: Invoke Escalation Tool:** Once the email address is provided, invoke the **'EsclateToHumanSupportMail'** tool. Ensure the user's technical query details and their provided email address are passed to the tool.
    *   **Step 4: Inform User:** After successfully invoking the tool, inform the user. For example: "Thank you. Your technical issue has been escalated to our human support team. They will contact you via email to provide further assistance."

**Important Prohibitions:**
*   **NEVER** attempt to answer general (non-technical) product questions, sales inquiries, or company policy questions.
*   **NEVER** attempt to answer questions about billing details, invoices, payments, or refunds.
*   **NEVER** ask for information that is not directly relevant to diagnosing or resolving the stated technical issue, with the exception of requesting an email address SOLELY for escalation purposes as defined in rule #4.
*   **NEVER** guarantee a fix if it's beyond standard troubleshooting procedures you can guide.

<tools>
  <tool>
    <name>ToGeneralAssistant</name>
    <description>Transfers the customer to the AI general assistant for general, non-technical, non-billing questions.</description>
  </tool>
  <tool>
    <name>ToBillingAssistant</name>
    <description>Transfers the customer to the AI billing assistant for any billing-related issues.</description>
  </tool>
  <tool>
    <name>EsclateToHumanSupportMail</name>
    <description>
        • Invoke when a user requests human escalation or the issue remains unresolved.  
        • Collect and forward the user's query details plus their email address.  
        • Technical Human support team will follow up directly via the provided email.
    </description>
  </tool>
</tools>
</instructions>
`;

  
const billingPrompt = `<instructions>
You are **RamsesAI_BillingSupport_Agent**, a specialized AI assistant for RamsesAI, a computer sales company. Your primary objective is to address and resolve user inquiries related exclusively to billing matters. You must be concise, professional, and accurate in your responses.

**Your Core Responsibilities:**
*   Answer questions and resolve issues related to RamsesAI billing, such as:
    *   Invoice clarifications (understanding charges, due dates).
    *   Payment queries (status, methods, failed payments).
    *   Subscription management (details, renewals, cancellations – if applicable).
    *   Refund status and processes.
    *   Account balance inquiries.
*   Maintain a high degree of accuracy and confidentiality when discussing billing information.
*   Adhere strictly to RamsesAI's billing policies and procedures.

**Critical Rules for Handling Queries:**

1.  **Handling Billing Inquiries:**
    *   Request necessary information (e.g., invoice number, customer ID – *only if essential and secure protocols are in place*) to access and discuss specific billing details.
    *   Provide clear explanations of billing statements, charges, and policies.
    *   Assist with payment-related issues as per your capabilities.
    *   If a billing issue requires manual intervention or access you don't have, clearly state this and offer to escalate.

2.  **Handling General Inquiries:**
    *   **Do NOT attempt to answer.**
    *   Immediately and politely invoke the **'ToGeneralAssistant'** tool.

3.  **Handling Technical Inquiries:**
    *   **Do NOT attempt to answer.**
    *   Immediately and politely invoke the **'ToTechnicalAssistant'** tool.

4.  **Handling Escalation Requests or Unresolvable Billing Issues:**
    *   If the user explicitly requests human support, if the billing issue is highly complex, requires sensitive data access beyond your permissions, or involves a dispute requiring human review.
    *   **Step 1: Request Email Address:** Politely ask the user for their email address. For example: "I can escalate this billing query to our human billing support team for you. Could you please provide your email address so they can follow up with you?"
    *   **Step 2: Await Email Address:** Wait for the user to provide their email address.
    *   **Step 3: Invoke Escalation Tool:** Once the email address is provided, invoke the **'EsclateToHumanSupportMail'** tool. Ensure the user's billing query details and their provided email address are passed to the tool.
    *   **Step 4: Inform User:** After successfully invoking the tool, inform the user. For example: "Thank you. Your billing query has been escalated to our human billing support team. They will contact you at the email address you provided."

**Important Prohibitions:**
*   **NEVER** attempt to answer general (non-billing, non-technical) product questions, sales inquiries, or company policy questions.
*   **NEVER** attempt to diagnose, troubleshoot, or resolve technical issues.
*   **NEVER** process payments or refunds directly unless explicitly designed and secured to do so. Confirm your exact capabilities.
*   **NEVER** disclose sensitive billing information without proper user verification (if applicable to your system's design), except for requesting an email address SOLELY for escalation purposes as defined in rule #4.

<tools>
  <tool>
    <name>ToGeneralAssistant</name>
    <description>Transfers the customer to the AI general assistant for general, non-technical, non-billing questions.</description>
  </tool>
  <tool>
    <name>ToTechnicalAssistant</name>
    <description>Transfers the customer to the AI technical assistant for any technical computer issues.</description>
  </tool>
  <tool>
    <name>EsclateToHumanSupportMail</name>
    <description>
        • Invoke when a user requests human escalation or the issue remains unresolved.  
        • Collect and forward the user's query details plus their email address.  
        • Billing Human support team will follow up directly via the provided email.
    </description>
  </tool>
</tools>
</instructions>
`;


const ToGeneralAssistant: StructuredToolParams= {
  name: "ToGeneralAssistant",
  description: "Transfer the customer back to the ai general assistant that can help with general questions",
  schema: z.object({
      customerQuery: z.string().describe("The customer's query regarding his generic issue")
  })
}


const ToTechnicalAssistant: StructuredToolParams= {
  name: "ToTechnicalAssistant",
  description: "Transfer the customer to the ai technical assistant that can help with technical issues",
  schema: z.object({
      customerQuery: z.string().describe("The customer's query regarding his technical issue")
  })
}
 
const ToBillingAssistant: StructuredToolParams= {
    name: "ToBillingAssistant",
    description: "Transfer the customer back to the ai billing assistant that can help with general questions",
    schema: z.object({
        customerQuery: z.string().describe("The customer's query regarding his billing issue")
    })
  }

const EsclateToHumanSupportMail: StructuredToolParams= {
    name: "EsclateToHumanSupportMail",
    description: "Transfer the customer to the human support team via email",
    schema: z.object({
      subject: z.string().describe("The subject of the email"),
      content: z.string().describe("Briefly describe the customer's issue"),
      customer_email: z.string().describe("The customer's email address"),
      })
  }
  
// Define a more specific type for your email data if needed
interface CustomMailData {
  to: string | { email: string, name?: string }; // Allow string or object for 'to'
  from: string | { email: string, name?: string }; 
  subject: string;
  text: string; 
  html: string; 
}

export async function sendEmail(data: CustomMailData): Promise<void> {
  const msg: MailDataRequired = { 
    to: data.to,
    from: data.from, 
    subject: data.subject,
    text: data.text,
    html: data.html,
  };

  try {
    await sgMail.send(msg);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
    if (error instanceof Error && 'response' in error) {
      if (error instanceof Error && 'response' in error && typeof error.response === 'object' && error.response !== null && 'body' in error.response) {
        console.error((error.response as { body: any }).body);
      }
    }
    throw error; 
  }
}
// Function to generate the HTML content
function generateSupportEmailHtml(
  emailType: string,
  subject: string,
  customerIssue: string,
  customerEmail: string,
  userThreadId: string,
  companyName: string = "", // Optional: Make company name dynamic
  logoUrl?: string // Optional: URL for your company logo
): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${emailType} Support Request: ${subject}</title>
      <style>
        body {
          font-family: 'Arial', sans-serif;
          line-height: 1.6;
          color: #333333;
          margin: 0;
          padding: 0;
          background-color: #f4f4f4;
        }
        .container {
          max-width: 600px;
          margin: 20px auto;
          padding: 20px;
          background-color: #ffffff;
          border: 1px solid #dddddd;
          border-radius: 5px;
        }
        .header {
          text-align: center;
          padding-bottom: 20px;
          border-bottom: 1px solid #eeeeee;
        }
        .header img {
          max-width: 150px;
          margin-bottom: 10px;
        }
        .header h1 {
          font-size: 24px;
          color: #333333;
          margin: 0;
        }
        .content {
          padding: 20px 0;
        }
        .content h2 {
          font-size: 20px;
          color: #555555;
        }
        .content p {
          margin-bottom: 15px;
        }
        .info-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        .info-table th, .info-table td {
          text-align: left;
          padding: 8px;
          border-bottom: 1px solid #eeeeee;
        }
        .info-table th {
          background-color: #f9f9f9;
          width: 30%;
        }
        .footer {
          text-align: center;
          padding-top: 20px;
          border-top: 1px solid #eeeeee;
          font-size: 12px;
          color: #777777;
        }
        .footer p {
          margin: 5px 0;
        }
        .highlight {
          font-weight: bold;
          color: #007bff;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${logoUrl ? `<img src="${logoUrl}" alt="${companyName} Logo">` : ''}
          <h1>${emailType} Support Request</h1>
        </div>
        <div class="content">
          <h2>Subject: ${subject}</h2>
          <p>Dear Support Team,</p>
          <p>A new customer issue has been submitted. Please find the details below:</p>
          
          <h3>Customer Issue:</h3>
          <p style="padding: 10px; background-color: #f9f9f9; border-left: 3px solid #007bff;">
            ${customerIssue.replace(/\n/g, '<br>')}
          </p>

          <h3>User Information:</h3>
          <table class="info-table">
            <tr>
              <th>User's Email:</th>
              <td><a href="mailto:${customerEmail}">${customerEmail}</a></td>
            </tr>
            <tr>
              <th>User's Thread ID:</th>
              <td>${userThreadId}</td>
            </tr>
            <tr>
              <th>Request Type:</th>
              <td class="highlight">${emailType}</td>
            </tr>
          </table>
          
          <p>Please address this issue at your earliest convenience.</p>
          <p>Thank you.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
          <p>This is an automated notification. Please do not reply directly to this email if not intended for the support system.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}  


// Graph State
const GenericStateAnnotation= Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => []
    }),
    billMessages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => []
    }),
    techMessages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => []
    }),
    userQuery: Annotation<string>,
    currentAssistant: Annotation<string>({
      reducer: (state, action) => action ?? "ToGeneralAssistant",
      default: () => "ToGeneralAssistant"
  }),
})


const genericAssistant= async(state: typeof GenericStateAnnotation.State) => {
  const chatModelWithTools= chatModel.bindTools([ToBillingAssistant, ToTechnicalAssistant, EsclateToHumanSupportMail])
  let response
  response= await chatModelWithTools.invoke([
      new SystemMessage({content: generalPrompt}),
      ...state.messages,
      new HumanMessage({content: state.userQuery}),
  ])

  if (response?.tool_calls?.length === 0) {
      return new Command ({
          update: {
              messages: [new HumanMessage({content: state.userQuery || '', id: uuidv4()})].concat([response]),
              currentAssistant: 'ToGeneralAssistant',
          },
          goto: END
      })    
  } else if(response?.tool_calls?.[0]?.['name'] === 'EsclateToHumanSupportMail') {
      return new Command({
          update: {
              currentAssistant: "ToGeneralAssistant",
              messages: [new HumanMessage({content: state.userQuery, id: uuidv4()})].concat([response]),
          },
          goto: 'EsclateToHumanSupportNode'
      })
  } else {
      return new Command({
          update: {
              currentAssistant: response?.tool_calls && response.tool_calls[0]?.['name'],
              userQuery: response?.tool_calls?.[0]?.['args']['customerQuery'],
          },
          goto: response?.tool_calls?.[0]?.['name']
          })
      }
  }
  

const technicalAssistant= async(state: typeof GenericStateAnnotation.State) => {
        const chatModelWithTools= chatModel.bindTools([ToBillingAssistant, ToGeneralAssistant, EsclateToHumanSupportMail])
        let response
        response= await chatModelWithTools.invoke([
            new SystemMessage({content: technicalPrompt}),
            ...state.techMessages,
            new HumanMessage({content: state.userQuery}),
        ])
      
        if (response?.tool_calls?.length === 0) {
            return new Command ({
                update: {
                    techMessages: [new HumanMessage({content: state.userQuery || '', id: uuidv4()})].concat([response]),
                    currentAssistant: 'ToTechnicalAssistant',
                },
                goto: END
            })    
            // }
        } else if(response?.tool_calls?.[0]?.['name'] === 'EsclateToHumanSupportMail') {
            return new Command({
                update: {
                    currentAssistant: "ToTechnicalAssistant",
                    techMessages: [new HumanMessage({content: state.userQuery, id: uuidv4()})].concat([response]),
                },
                goto: 'EsclateToHumanSupportNode'
            })
        } else {
            return new Command({
                update: {
                    currentAssistant: response?.tool_calls && response.tool_calls[0]?.['name'],
                    userQuery: response?.tool_calls?.[0]?.['args']['customerQuery'],
                },
                goto: response?.tool_calls?.[0]?.['name']
                })
            }
        }


const billingAssistant= async(state: typeof GenericStateAnnotation.State) => {
    const chatModelWithTools= chatModel.bindTools([ToGeneralAssistant, ToTechnicalAssistant, EsclateToHumanSupportMail])
    let response
    response= await chatModelWithTools.invoke([
        new SystemMessage({content: billingPrompt}),
        ...state.billMessages,
        new HumanMessage({content: state.userQuery}),
    ])  
    if (response?.tool_calls?.length === 0) {
        return new Command ({
            update: {
                billMessages: [new HumanMessage({content: state.userQuery || '', id: uuidv4()})].concat([response]),
                currentAssistant: 'ToBillingAssistant',
                escalationResponse: false
            },
            goto: END
        })    
        // }
    } else if(response?.tool_calls?.[0]?.['name'] === 'EsclateToHumanSupportMail') {
        console.log("EsclateToHumanSupprt Billing called")
        return new Command({
            update: {
                currentAssistant: "ToBillingAssistant",
                billMessages: [new HumanMessage({content: state.userQuery, id: uuidv4()})].concat([response]),
            },
            goto: 'EsclateToHumanSupportNode'
        })
    } else {
        return new Command({
            update: {
                currentAssistant: response?.tool_calls && response.tool_calls[0]?.['name'],
                userQuery: response?.tool_calls?.[0]?.['args']['customerQuery'],
            },
            goto: response?.tool_calls?.[0]?.['name']
            })
        }
  }
  
  
const EsclateToHumanSupportNode = async(state: typeof GenericStateAnnotation.State, config: RunnableConfig) => {
  let toolCalls;
  let toolCallId;
  
  if (state.currentAssistant === "ToGeneralAssistant") {
    toolCalls = (state?.messages?.at(-1) as any)?.tool_calls;
    toolCallId = toolCalls?.[0]?.id;
  } else if (state.currentAssistant === "ToTechnicalAssistant") {
    const lastTechMessage = state?.techMessages?.at(-1) as any; // Cast to 'any' or a specific type that includes 'tool_calls'
    console.log("state?.techMessages?.at(-1).tool_calls:", lastTechMessage?.tool_calls);
    toolCalls = (state?.techMessages?.at(-1) as any)?.tool_calls;
    toolCallId = toolCalls?.[0]?.id;
  } else if (state.currentAssistant === "ToBillingAssistant") {
    toolCalls = (state?.billMessages?.at(-1) as any)?.tool_calls;
    toolCallId = toolCalls?.[0]?.id;
  }
  
  if (!toolCalls || !toolCalls[0]) {
    console.error("No tool calls found in message");
    throw new Error("No tool calls found in message");
  }
  
  const email_data = toolCalls[0].args;
  const user_thread_id = config?.configurable?.thread_id;
  let supportEmailAddress: string="ramzirebai1992@gmail.com"
  let emailType: string=""
  switch(state.currentAssistant) {
    case "ToGeneralAssistant":
      supportEmailAddress = "ramzirebai1992@gmail.com"; // Or a specific general support address
      emailType = "General Inquiry";
      break; // Crucial: Add break statements
    case "ToTechnicalAssistant":
      supportEmailAddress = "ramzirebai1992@gmail.com"; // Or a specific tech support address
      emailType = "Technical Support";
      break;
    case "ToBillingAssistant":
      supportEmailAddress = "ramzirebai1992@gmail.com"; // Or a specific billing support address
      emailType = "Billing Support";
      break;
  }
  
  const emailSubject = `${emailType} Request: ${email_data.subject || "Customer Support Request"}`;
  
  // Generate the HTML content
  const htmlContent = generateSupportEmailHtml(
    emailType,
    email_data.subject || "N/A",
    email_data.content,
    email_data.customer_email,
    user_thread_id,
    "Your Awesome RamsesAI Company Inc.", // Optional: Company Name
    "https://i.ibb.co/S4K0zBnr/pharaoh.png" // Optional: Link to your logo
  );
  
  // Create a plain text version as a fallback
    const textContent = `
    New ${emailType} Request
    Subject: ${email_data.subject || "Customer Support Request"}
    
    Customer Issue:
    ${email_data.content}
    
    User's Information:
    User's Email: ${email_data.customer_email}
    User's Thread ID: ${user_thread_id}
    
    Please address this issue.
    
    Regards,
    Automated Support System
    Your Awesome Company Inc.
    `;
  
  try {
    await sendEmail({
      to: { email: supportEmailAddress, name: `${emailType} Team` }, // Example of using an object for 'to'
      from: { email: 'ramzi.rebai.01@gmail.com', name: 'RamsesAI Notification System' }, // Use a descriptive sender name
      subject: emailSubject,
      text: textContent, // Plain text fallback
      html: htmlContent, // HTML content
    });
    console.log(`Support email for ${emailType} sent to ${supportEmailAddress}`);
  } catch (error) {
    console.error(`Failed to send ${emailType} support email:`, error);
    // Handle the error appropriately (e.g., log, retry, notify admin)
  }
  
    console.log(`Email sent successfully for session: ${user_thread_id}`);


  switch(state.currentAssistant) {
    case "ToGeneralAssistant":
      return new Command({
        update: {
          messages: [new ToolMessage({content: "Email sent to the General Human support team", tool_call_id: toolCallId})],
          currentAssistant: 'human_support'
        },
        goto: "ToGeneralAssistant"
      });
    case "ToTechnicalAssistant":
      return new Command({
        update: {
          techMessages: [new ToolMessage({content: "Email sent to the Technical Human support team", tool_call_id: toolCallId})],
          currentAssistant: 'human_support'
        },
        goto: "ToTechnicalAssistant"
      });
    case "ToBillingAssistant":
      return new Command({
        update: {
          billMessages: [new ToolMessage({content: "Email sent to the Billing Human support team", tool_call_id: toolCallId})],
          currentAssistant: 'human_support'
        },
        goto: "ToBillingAssistant"
      });

  }
};


const routeUserQuery= async (state: typeof GenericStateAnnotation.State) => {
  console.log("Current assistant:\n", state.currentAssistant);
  return state.currentAssistant
}

const workflow= new StateGraph(GenericStateAnnotation)
.addNode('ToGeneralAssistant', genericAssistant,  {ends: ['ToTechnicalAssistant', 'ToBillingAssistant', 'EsclateToHumanSupportNode', END]})
.addNode('ToTechnicalAssistant', technicalAssistant, {ends: ['ToGeneralAssistant', 'ToBillingAssistant', 'EsclateToHumanSupportNode', END]})
.addNode('ToBillingAssistant', billingAssistant, {ends: ['ToGeneralAssistant', 'ToTechnicalAssistant', 'EsclateToHumanSupportNode', END]})
.addNode('EsclateToHumanSupportNode', EsclateToHumanSupportNode)
.addConditionalEdges(START, routeUserQuery, ['ToGeneralAssistant', 'ToTechnicalAssistant', 'ToBillingAssistant'])

const appGraph= workflow.compile({checkpointer: pg_checkpointer})
// const appGraph= workflow.compile({checkpointer: memoryCheckpointer})

async function formatWorkflowResponses(workflowResponse: any)  {                
  switch(workflowResponse.currentAssistant) {
    case "ToGeneralAssistant":
      return {
        response: workflowResponse.messages.at(-1).content,
        currentAssistant: workflowResponse.currentAssistant,
      };
    case "ToTechnicalAssistant":
      return {
        response: workflowResponse.techMessages.at(-1).content,
        currentAssistant: workflowResponse.currentAssistant,
      };
    case "ToBillingAssistant":
      return {
        response: workflowResponse.billMessages.at(-1).content,
        currentAssistant: workflowResponse.currentAssistant,
      };
  }
}

const FormattedWorkflow= appGraph.pipe(RunnableLambda.from(formatWorkflowResponses))

const PORT= process.env.PORT || 3001
const wsServer= new WebSocketServer({ port: 3001})

wsServer.on("connection", (wsClient) => {
    console.log("New client connected");

    wsClient.on("message", async (data: any) => {
        try {
            const messageBuffer = Buffer.isBuffer(data) ? data.toString() : data;
            let jsonParse;
            try {
                jsonParse = JSON.parse(messageBuffer);
            } catch (error) {
                console.error("Invalid JSON format received:", messageBuffer);
                wsClient.send(JSON.stringify({ error: "Invalid message format", source: "chatbot" }));
                return; // Early return to avoid further processing
            }

            const { type, message, sessionId } = jsonParse;

            // Handle 'ping' messages
            if (type === 'ping') {
                wsClient.send(JSON.stringify({ type: 'pong' }));
                return; // Do not process further
            }

            // Validate message type
            if (type !== 'message') {
                wsClient.send(JSON.stringify({ error: "Invalid message type", source: "chatbot" }));
                return; // Early return to avoid further processing
            }

            console.log("Parsed message:\n", jsonParse);
            const response= await FormattedWorkflow.invoke(
                {userQuery: message},
                {configurable: {thread_id: sessionId}}
            )
            // console.log("Final Response:\n", response)
            wsClient.send(JSON.stringify(response))

        } catch (error) {
            console.error("Error processing message", error);
            wsClient.send(JSON.stringify({ error: "We're out of API, please try again later" }));
        }
    });
  
    wsClient.on("close", () => {
      console.log("Client disconnected");
    });
  
    wsClient.on("error", (error) => {
      console.error("WebSocket error", error);
      wsClient.send(JSON.stringify({ error: "A connection error occurred. Please try again later." }));
    });
});
console.log(`WebSocket server is running on ws://localhost:${PORT}`);

