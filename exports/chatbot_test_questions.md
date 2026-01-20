# GRC Platform Chatbot Test Questions

## Overview
This document contains 150+ test questions organized by module and complexity level (Low, Medium, High, Expert) to validate the GRC chatbot's knowledge and capabilities.

---

## 1. FRAMEWORKS & REGULATORY COMPLIANCE (25 Questions)

### Low Complexity
1. What regulatory frameworks are available in the system?
2. How many controls does ISO 27001 have?
3. List all the domains in PCI DSS framework.
4. What is the difference between mandatory and advisory controls?
5. How do I upload a new regulatory framework?

### Medium Complexity
6. Which frameworks have controls related to access control?
7. Compare the number of controls between ISO 27001 and NIST CSF.
8. What are the common control domains shared between SOX and Basel?
9. Show me all high-priority controls in GDPR framework.
10. Which framework has the most controls related to encryption?

### High Complexity
11. Map ISO 27001 Annex A.9 controls to equivalent PCI DSS requirements.
12. Identify all cross-framework control mappings for access management.
13. What evidence is commonly required for both ISO 27001 A.5.1.1 and PCI DSS Requirement 12.1?
14. Analyze the overlap between NIST CSF PR.AC and ISO 27001 A.9 controls.
15. Which controls appear in 3 or more frameworks with similar requirements?

### Expert Complexity
16. Perform gap analysis between our implemented controls and SOC 2 Type II requirements.
17. If we're compliant with ISO 27001, what additional controls do we need for PCI DSS certification?
18. Create a unified control matrix for organizations needing ISO 27001, SOC 2, and GDPR compliance.
19. Identify conflicting requirements between different regulatory frameworks.
20. What is the recommended implementation order for achieving multi-framework compliance?

### Framework-Specific Deep Dive
21. Explain the hierarchical structure of ISO 27001:2022 controls.
22. What are the key differences between PCI DSS v3.2.1 and v4.0?
23. How does GDPR Article 30 ROPA requirement translate to auditable evidence?
24. What are Basel III Pillar 1 capital requirements?
25. Explain the NIST CSF Identify function subcategories.

---

## 2. RISK MANAGEMENT (25 Questions)

### Low Complexity
26. How many risks are registered in the system?
27. What are the different risk categories available?
28. Show me all critical risks.
29. What is a risk appetite statement?
30. How do I create a new risk entry?

### Medium Complexity
31. List all risks with inherent score above 15.
32. Which risks have no assigned treatment plans?
33. Show me risks that are past their review date.
34. What is the total residual risk exposure by category?
35. Which risks are linked to the most controls?

### High Complexity
36. Analyze the effectiveness of risk treatments over the past 12 months.
37. Which business units have the highest concentration of high-impact risks?
38. Identify risks that have exceeded their risk appetite thresholds.
39. What is the correlation between risk scores and incident frequency?
40. Show me risks where residual risk is still above acceptable levels after treatment.

### Expert Complexity
41. Perform Monte Carlo simulation for our top 10 risks.
42. What is the aggregated risk exposure across all operational risk categories?
43. Predict which risks are likely to materialize based on historical patterns.
44. How do emerging risks from threat intelligence affect our risk register?
45. Calculate the Value at Risk (VaR) for our information security risks.

### Risk Analysis & Reporting
46. Generate a risk heatmap by business unit.
47. What is our organization's overall risk posture score?
48. Show me the trend of risk scores over the last 4 quarters.
49. Which Key Risk Indicators (KRIs) are trending towards breach?
50. List all risk incidents that occurred in the last 90 days.

---

## 3. EVIDENCE MANAGEMENT (20 Questions)

### Low Complexity
51. How many evidence files are uploaded in the system?
52. What types of evidence are supported?
53. Show me all pending evidence for review.
54. How do I upload evidence for a specific control?
55. What is the evidence retention policy?

### Medium Complexity
56. Which controls have no evidence attached?
57. Show me evidence that expires within 30 days.
58. List all evidence with AI quality score below 70%.
59. Which controls require the most evidence types?
60. What percentage of our controls have complete evidence?

### High Complexity
61. Identify evidence gaps for upcoming ISO 27001 audit.
62. Which departments have the lowest evidence completion rates?
63. Analyze evidence quality trends across different control domains.
64. What common issues does AI find in our uploaded evidence?
65. Generate an evidence readiness report for PCI DSS assessment.

### Expert Complexity
66. Prioritize evidence collection based on audit timeline and control criticality.
67. Which evidence can be reused across multiple frameworks?
68. What is the effort estimate to achieve 100% evidence coverage?
69. Recommend optimal evidence refresh cycles based on control type.
70. Map evidence requirements to organizational document management system.

---

## 4. GOVERNANCE & POLICY MANAGEMENT (20 Questions)

### Low Complexity
71. How many policies are in the system?
72. List all policies pending approval.
73. What is the policy review cycle?
74. Show me the Information Security Policy.
75. How do I create a new policy document?

### Medium Complexity
76. Which policies are overdue for review?
77. Show me the approval workflow for policies.
78. List all policies linked to ISO 27001 controls.
79. What policies were updated in the last quarter?
80. Which policies have the most version history?

### High Complexity
81. Identify policy gaps for GDPR compliance.
82. Analyze policy coverage across all control domains.
83. Which policies conflict with each other?
84. Show me policies that reference outdated controls.
85. Generate a policy alignment matrix with regulatory requirements.

### Expert Complexity
86. Recommend policy consolidation opportunities.
87. What is the maturity level of our policy management program?
88. How do industry peers structure their policy hierarchy?
89. Perform semantic analysis of policy content for inconsistencies.
90. Create a policy update roadmap for new regulatory requirements.

---

## 5. IT ASSET INVENTORY (15 Questions)

### Low Complexity
91. How many IT assets are registered?
92. List all critical assets.
93. What asset categories exist?
94. Show me assets in the Production environment.
95. How do I add a new asset?

### Medium Complexity
96. Which assets are not linked to any controls?
97. Show me assets by business criticality.
98. List assets with outdated vulnerability scans.
99. What is the total valuation of IT assets by department?
100. Which assets have the most associated risks?

### High Complexity
101. Identify assets that are single points of failure.
102. Analyze asset dependencies and impact chains.
103. Which assets require additional controls based on their criticality?
104. Generate asset-to-control coverage report for audit.
105. What is the cyber insurance valuation of our critical assets?

---

## 6. VULNERABILITY MANAGEMENT (25 Questions)

### Low Complexity
106. How many open vulnerabilities are there?
107. List all critical severity vulnerabilities.
108. What is the SLA for critical vulnerabilities?
109. Show me vulnerabilities assigned to IT Security.
110. How do I upload a vulnerability scan report?

### Medium Complexity
111. Which vulnerabilities are past SLA?
112. Show me vulnerability trends by severity level.
113. List vulnerabilities with AI-generated fix recommendations.
114. What is the mean time to remediate by department?
115. Which CVEs are present in our environment?

### High Complexity
116. Identify vulnerabilities affecting production systems.
117. Analyze the correlation between vulnerabilities and compliance gaps.
118. Which vulnerabilities map to active threat intelligence?
119. Generate a prioritized remediation plan based on risk exposure.
120. What is the patch coverage rate by operating system?

### Expert Complexity
121. Calculate our vulnerability debt and remediation capacity.
122. Predict vulnerability recurrence based on historical data.
123. Perform exploit likelihood analysis using EPSS scores.
124. How do our vulnerability metrics compare to industry benchmarks?
125. Create a vulnerability management maturity assessment.

### SLA & Escalation
126. Show me escalated vulnerabilities.
127. What is the escalation path for critical vulnerabilities?
128. List vulnerabilities with pending escalation.
129. Which departments have the worst SLA compliance?
130. Generate an escalation effectiveness report.

---

## 7. UNIFIED CONTROL LIBRARY (15 Questions)

### Low Complexity
131. What is a common control group?
132. How many common control groups exist?
133. Show me controls in the Access Control group.
134. What is control inheritance?
135. How do I create a control mapping?

### Medium Complexity
136. Which controls are mapped across the most frameworks?
137. Show me AI similarity scores for control mappings.
138. List all unmapped controls by framework.
139. What is the harmonization score for our control library?
140. Which common controls have conflicting implementation requirements?

### High Complexity
141. Generate a control harmonization report for multi-framework compliance.
142. Identify control consolidation opportunities.
143. Analyze control testing coverage across frameworks.
144. Which controls provide the most compliance coverage per effort?
145. Create a control rationalization strategy.

---

## 8. INTERNAL CONTROLS REGISTER (10 Questions)

### Low Complexity
146. How many internal controls are documented?
147. Show me controls pending testing.
148. What is the control testing frequency?

### Medium Complexity
149. Which internal controls failed their last test?
150. List controls by control type (preventive/detective/corrective).
151. What is the control effectiveness rating distribution?

### High Complexity
152. Identify control design gaps versus operating effectiveness issues.
153. Which controls need remediation based on test failures?
154. Analyze control testing trends over time.

### Expert
155. Perform SOX 404 control assessment readiness analysis.

---

## 9. CROSS-MODULE ANALYTICS (15 Questions)

### Medium Complexity
156. Show me the relationship between risks and their linked controls.
157. Which evidence supports the most high-priority controls?
158. What is the overall compliance posture by framework?
159. List all items requiring attention in the next 7 days.
160. Generate a compliance dashboard summary.

### High Complexity
161. Perform end-to-end traceability from risk to control to evidence.
162. What is the correlation between control maturity and incident frequency?
163. Identify weak links in our governance, risk, and compliance chain.
164. How do changes in risk scores affect compliance status?
165. Generate an executive compliance summary for board presentation.

### Expert Complexity
166. Predict compliance gaps based on current trends.
167. Perform root cause analysis on recurring compliance issues.
168. What is the ROI of our GRC program investments?
169. How does our GRC maturity compare to industry standards?
170. Create a 12-month GRC improvement roadmap.

---

## 10. SYSTEM ADMINISTRATION & CONFIGURATION (10 Questions)

### Low Complexity
171. Who has access to the system?
172. What roles are available?
173. Show me audit logs for today.

### Medium Complexity
174. Which users have the most permissions?
175. List all tenant configurations.
176. Show me recent system configuration changes.

### High Complexity
177. Analyze user activity patterns for anomalies.
178. What is the access review compliance status?
179. Generate a privileged access report.
180. Perform segregation of duties analysis.

---

## BONUS: NATURAL LANGUAGE QUERY TESTS (20 Questions)

### Conversational Queries
181. Help me prepare for our ISO 27001 audit next month.
182. What should I focus on first - risks or controls?
183. We just had a security incident. What do I need to do?
184. Can you explain our compliance status in simple terms?
185. What's the quickest way to improve our security posture?

### Contextual Understanding
186. The auditor asked about our access control policy. Where is it?
187. We need to report our risk exposure to the board. Help me create a summary.
188. A new regulation requires encryption at rest. Do we comply?
189. Show me everything related to data protection.
190. Our penetration test found 50 vulnerabilities. What's next?

### Complex Multi-Part Queries
191. Compare our current controls with last year and identify improvement areas.
192. If we want SOC 2 certification, what's missing and how long will it take?
193. Show me high-risk items without controls, evidence, or assigned owners.
194. What would be the impact if we lost access to our primary database server?
195. We're expanding to Europe. What additional compliance requirements apply?

### Edge Cases
196. What if a control is mandatory in one framework but optional in another?
197. How do we handle controls that are partially implemented?
198. What happens if evidence expires during an audit?
199. Can the same evidence satisfy multiple control requirements?
200. How do we prioritize when we have limited resources?

---

## Question Complexity Distribution Summary

| Complexity Level | Count | Percentage |
|-----------------|-------|------------|
| Low             | 45    | 22.5%      |
| Medium          | 55    | 27.5%      |
| High            | 60    | 30.0%      |
| Expert          | 40    | 20.0%      |
| **Total**       | **200** | **100%** |

---

## Usage Notes

1. **Testing Order**: Start with Low complexity to verify basic retrieval, then progress to higher complexity.
2. **Expected Behavior**: Low/Medium should return factual data; High/Expert should demonstrate analytical reasoning.
3. **Evaluation Criteria**: Accuracy, completeness, relevance, and actionability of responses.
4. **Edge Case Testing**: Questions 196-200 test the system's handling of ambiguous or complex scenarios.
