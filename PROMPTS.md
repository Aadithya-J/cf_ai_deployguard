# Development prompts

These are the development prompts supplied during this project. Credential values are redacted. Original wording is retained. The project began with the official Cloudflare Agents starter, as credited in README.md.

LIST of prompts:
1.  we are building deployGuard an ai assisted progressive deployment platform for Cloudflare Workers.
  this repo was created from the official cloudflare/agents-starter.
  the intended product flow is:
  - dev provides a gitHub pr associated with a candidate worker version.
  - deployGuard reads the pr diff and uses workers ai to summarize the change, identify potentially affected areas, estimate deployment risk, and suggest relevant validation checks.
  - the candidate Worker version is smoke-tested before receiving normal traffic.
  - deployGuard then performs a real gradual deployment using Cloudflare Worker Versions/Deployments, initially routing a small percentage of traffic to the candidate.
  - It generates/observes test traffic and compares basic health signals such as error rate, latency and endpoint success between the stable and candidate versions.
  - Promotion and rollback decisions are governed by deterministic safety rules rather than arbitrary LLM decisions.
  - Healthy canaries can wait for human approval before full promotion.
  - Failed canaries are rolled back, after which the AI can use the PR diff, health results and relevant logs to explain the likely failure.
  - Deployment history, analyses and outcomes should persist so the Agent can answer questions about previous deployments.
  - The product should have a dashboard as its primary interface, with chat as an additional way to inspect and understand deployments rather than being the entire application.We want to build this primarily using Cloudflare’s own platform: Workers, Agents/Durable
  objects, workers ao, workflows, worker versions/deployments apis, and Cloudflare observability, with React/TypeScript for the frontend and GitHub only for retrieving PR information.
  please consult the official cloudflare documetn when necessary

  for now i want you to:
  explain what architecture the starter currently gives us;
  evaluate how the deployguard requirements should map onto cloudflare primitives;
  propose a minimal v1 architecture and implementation sequence;
  identify anything in my proposed design that is unnecessary, unsafe, or better handled differently;
  verify the current dependencies/configuration, including the earlier tsconfig warning and Wrangler version;
  make only small foundational fixes if required to get the starter into a clean working state.
  do not start building the DeployGuard feature set yet. I want to review the architecture and implementation plan first.
  run basic chcecks to ensure starter is working

2. i ran the dev server an tested but i'm not receiving the ai response i checked the logs it is due to being on workers free plan. so
  switch the llm to this model LLM (recommend using Llama 3.3 on Workers AI) 


3.  for v1 keep the scope to one cloudflare account and the disposable demo target worker.
  we do not need multie proejct,d1,r2 etc for now.
  create a minimal disposable target Worker suitable for deployhuard testing. It should have a small set of endpoints such as health and a
  simple application endpoint, and every response should make its deployed version identifiable so we can attribute traffic to stable vs
  candidate versions.

  abd then verify the deployment flow
  first deploy initial version
  upload a second version without immediately without replacing prod
  confirm that version can be addressed/tested independently;
  perform a real percentage-based deployment between the two versions;
  verify requests are reaching both versions and can be attributed correctly;
  restore the stable version to 100%;
  confirm the final deployment state
  use the current cloudflare documentaiton whenever necesssary.
  check if there are any constraints.
  also investigate what telemetry we can reliably obtain on the Free plan for distinguishing candidate health from stable health, but don't
  build the monitoring system yet.
  at the end summarize and report the behaviour observed if any limitations etc
 
4.  next i want to define the minimal deterministic deployment lifecycle and safety policy before adding AI.
design and implement the v1 state machine for: candidate validation - smoke test - canary - health evaluation - approval/promotion or rollback.
keep promotion/rollback fully deterministic. handle insufficient telemetry conservatively, confirm actual cloudflare deployment state after mutations, and prevent overlapping runs.
add focused tests for healthy, unhealthy, inconclusive, stale approval, and rollback cases.
Keep this minimal and don’t add GitHub or AI yet.
at the end, show me the state machine, safety rules, tests, and any issues you think we should resolve before continuing.

5.the deterministic deployment controller is now strong enough for v1
before moving on relax the current any http failure means rollback rule into a more sensible candidate vs stable failure threshold while still keeping critical endpoint assertion failures as hard failures
also add a short post promotion health verification
after that move to the next product capability which is github pr analysis
given a pr url retrieve and validate the pr record its immutable commit sha associate it with an already uploaded candidate worker version fetch the diff and use workers ai to return structured advisory analysis including
summary
affected areas
risk level
likely failure modes
suggested checks from a constrained catalog
keep ai completely advisory and do not let it trigger deployment mutations
keep the implementation minimal and report any design decisions limitations or issues that i should review before we build the dashboard 

6. split the work into logical commits separating the different parts of the implementation 

7. i have made some minor changes to the demo worker and created
    the PR here is the link:
  https://github.com/Aadithya-J/deployguard/pull/1
  you can use this to check and give the summary including this

8. upload the candiate version an hten test on it. why are
  you doing it only locally ?
 
9. next connect and verify the complete deployguard backend flow end to end through the actual worker and durable object rather than local result persistence  
use pr 1 and the existing uploaded candidate version as the live test case  
the flow should create a persisted deployment run perform pr analysis validate the candidate run the existing smoke test and canary lifecycle persist state across the run and expose enough read state for the frontend to consume later
test the real deployed path and report anything that behaves differently

10. i will provide dedicated tokens for cloudflare and github

11.  CLOUDFLARE_API_TOKEN=...
  GITHUB_TOKEN=...
  CLOUDFLARE_ACCOUNT_ID=...
  added to .dev.vars

  you can use this to set for deployed
bunx wrangler secret put CLOUDFLARE_API_TOKEN
bunx wrangler secret put GITHUB_TOKEN


12.before moving to frontendi wnat one live failure so we can cveiry the roll back path against cloudflare deployment state. create and upload a deliberately unhealthy candidate
for hte dmeo worker that violates the safety without policty without introcucitn compleixty.
run it through the same deployed backedn flow confirm it bcomees unheallthy and it rolls back

13. update rollback confirmation so cloudflare reporting stable at 100 percent is not
  enough keep the run locked until a short window of real attributed traffic confirms
  only the stable version is serving

  if candidate traffic continues past a reasonable timeout mark the run needs_attention
  instead of rolled_back add focused tests and rerun the live rollback check if practical

14. build the minimal deployguard dashboard on top of the existing backend showing deployment history pr
  analysis current run state live canary health approval controls rollback status and final outcome
  keep chat available as a secondary interface for questions about stored deployments but make the
  dashboard the primary experience and avoid adding new backend features unless the frontend exposes a
  real gap

15.  add a reviewer friendly demo mode so anyone opening the deployed app can view deployment history pr
  analysis health results rollback evidence and chat over stored runs without needing the admin token
  while keeping all mutation actions such as starting deployments approving promotion or rollback
  protected behind admin authentication

16.reviewer freidnly mode  should be able to also trigger a predefined rehearsel and shoudl be abel t
  review the runs also 

17. create two PR one for heallthy rehearsel and failr rehearsel so taht hte review rcan trigger both types of deployment and hten see the live progress and the rollback if failured.
the reviewir should be able to trigger both types and hten see the proper reheasrsel progressing and hte PR analysis

18. can we keep the 4 options to maybe lesser idk and keep ti simpe lso
  revieiwre cna unerstwhat each does now its a bit complicated to understand

19. make the ask deployguard always open by default but keep the toggle

20. remove the 5 minute cooldown between demo runs but have the one
rune at a time lock so taht there no two parallele runs

20. i think you ahve gh access so you can probably do it and the nfix the dmeo pr urls everything along with it an the nrun tests also
and maybe chekc the existin runs also nmayeb fi those owuld break with hardcode dpr ro smth idk

21. you can erase historical recordsi f that makes it easier unels oyu alreay fxied it

22. now iw ant you to redo the readme so that its proper and like mentios teh demo and all in the fotnend hte url everyghig eke the redame cnocise as in the impronta info only a hte ned the more deild ueles one can be after that but li ekyou get my point it hosud be suhc tha threviewir can easiyl see go to url tesit otu and liek eplxnaion and htearchitecure or liek plxani oof hteuapa suamr yadn al lis therin the readme

23. do this after comeotin current tasks

24. adn check if we haveto cleanup any uselss josn or md fiels fomr hte repo which was pushed etc or its fine

25. afte competing current task
